#!/usr/bin/env node

const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const {
  ENVIRONMENTS,
  appDir,
  getApp,
  getApps,
  getHostApp,
  saveApps,
  validateApp,
  validateApps,
} = require("./lib/apps");
const { readHostRemoteUris } = require("./lib/host-env");
const {
  readEnvironmentFiles,
  writeEnvironmentFiles,
} = require("./lib/env-files");
const {
  defaultNodeId,
  isRecommended,
  listNodeVersions,
} = require("./lib/node-versions");
const processes = require("./lib/processes");
const {
  TERMINAL_APPS,
  isTerminalAvailable,
  listTerminals,
} = require("./lib/terminal");

const HOST = "127.0.0.1";
const PORT = Number(process.env.LAUNCHER_PORT) || 4321;
const MODES = ["web", "terminal"];
const MAX_BODY_BYTES = 512 * 1024;
const REQUESTED_TERMINAL = (
  process.env.MICROFRONTENDS_TERMINAL || ""
).toLowerCase();

const defaultTerminal = () =>
  isTerminalAvailable(REQUESTED_TERMINAL) ? REQUESTED_TERMINAL : "terminal";

const PUBLIC_DIR = path.join(__dirname, "public");
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// Resolves a GET path to a file inside public/, or null if it is not a known
// static type or escapes the directory (path traversal).
const staticTarget = (pathname) => {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const type = CONTENT_TYPES[path.extname(rel)];

  if (!type) {
    return null;
  }

  const full = path.join(PUBLIC_DIR, rel);

  if (full !== PUBLIC_DIR && !full.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    return null;
  }

  return { full, type };
};

const ALLOWED_HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
const ALLOWED_ORIGINS = ALLOWED_HOSTS.map((host) => `http://${host}`);

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/* ----------------------------------------------------------------------- */
/* Helpers                                                                  */
/* ----------------------------------------------------------------------- */

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    if (!(req.headers["content-type"] || "").startsWith("application/json")) {
      reject(new HttpError(415, "Se esperaba application/json"));
      return;
    }

    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Cuerpo demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {});
      } catch {
        reject(new HttpError(400, "JSON inválido"));
      }
    });
  });

// Blocks DNS rebinding and cross-site requests from other pages.
const isTrustedRequest = (req) => {
  const { host, origin } = req.headers;
  return (
    ALLOWED_HOSTS.includes(host) &&
    (!origin || ALLOWED_ORIGINS.includes(origin))
  );
};

const requireApp = (id) => {
  const app = getApp(id);

  if (!app) {
    throw new HttpError(400, `App desconocida: ${id}`);
  }

  return app;
};

const requireOneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${label} no válido: ${value}`);
  }

  return value;
};

const normalizeRemoteUrl = (value, app) => {
  let url;

  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new HttpError(400, `URL no válida para ${app.id}: ${value}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new HttpError(400, `La URL de ${app.id} debe ser http o https`);
  }

  // host/next.config.js appends "/_next/static/...", so no trailing slash.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
};

const requireTerminal = (id) => {
  const terminalApp = requireOneOf(
    id || defaultTerminal(),
    TERMINAL_APPS,
    "Terminal",
  );

  if (!isTerminalAvailable(terminalApp)) {
    const { label } = listTerminals().find((item) => item.id === terminalApp);
    throw new HttpError(
      400,
      `${label} no está instalado en esta Mac. Elige otra app de terminal.`,
    );
  }

  return terminalApp;
};

const resolveNode = (id) => {
  const versions = listNodeVersions();
  const wanted = id || defaultNodeId(versions);
  const node = versions.find((item) => item.id === wanted);

  if (!node) {
    throw new HttpError(400, `Versión de Node no disponible: ${wanted}`);
  }

  return node;
};

const CUSTOM_REMOTE_KEY = /^NEXT_PUBLIC_[A-Z0-9_]+$/;

const buildHostOverrides = (remotes = {}) => {
  const configured = getApps()
    .filter((app) => app.remoteKey)
    .map((app) => ({ id: app.id, remoteKey: app.remoteKey, port: app.port }));
  const knownKeys = new Set(configured.map((remote) => remote.remoteKey));

  Object.entries(remotes).forEach(([id, remote]) => {
    if (!remote.custom) {
      return;
    }
    if (!CUSTOM_REMOTE_KEY.test(remote.remoteKey || "")) {
      throw new HttpError(400, `Variable remote no válida para ${id}`);
    }
    if (knownKeys.has(remote.remoteKey)) {
      throw new HttpError(
        400,
        `La variable ${remote.remoteKey} ya está configurada`,
      );
    }

    knownKeys.add(remote.remoteKey);
    configured.push({ id, remoteKey: remote.remoteKey, custom: true });
  });

  return configured.reduce((overrides, remote) => {
    const choice = remotes[remote.id] || {};

    if (choice.mode === "local") {
      overrides[remote.remoteKey] = remote.custom
        ? normalizeRemoteUrl(choice.url, remote)
        : `http://localhost:${remote.port}`;
    } else if (choice.mode === "custom") {
      overrides[remote.remoteKey] = normalizeRemoteUrl(choice.url, remote);
    }

    return overrides;
  }, {});
};

/* ----------------------------------------------------------------------- */
/* Handlers                                                                 */
/* ----------------------------------------------------------------------- */

const gitBranchFor = (app) => {
  try {
    const branch = execFileSync(
      "git",
      ["-C", appDir(app), "branch", "--show-current"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
      },
    ).trim();

    return branch || "HEAD detached";
  } catch {
    return null;
  }
};

const getConfig = () => {
  const versions = listNodeVersions();

  return {
    environments: ENVIRONMENTS,
    terminals: listTerminals(),
    defaultTerminal: defaultTerminal(),
    nodeVersions: versions.map(({ id, version }) => ({
      id,
      version,
      recommended: isRecommended(version),
    })),
    defaultNode: defaultNodeId(versions),
    apps: getApps().map((app) => ({
      ...app,
      branch: gitBranchFor(app),
      invalid: Object.fromEntries(
        ENVIRONMENTS.map((env) => [env, validateApp(app, env)]),
      ),
    })),
    host: getHostApp()?.id || null,
    hostRemoteUris: Object.fromEntries(
      ENVIRONMENTS.map((env) => [env, readHostRemoteUris(env)]),
    ),
  };
};

const chooseDirectory = () =>
  new Promise((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(
        new HttpError(501, "El selector de carpetas está disponible en macOS"),
      );
      return;
    }

    execFile(
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Selecciona la carpeta del microfrontend")',
      ],
      (error, stdout) => {
        if (error) {
          reject(new HttpError(400, "No se seleccionó una carpeta"));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });

const startApps = async (body) => {
  const env = requireOneOf(body.env, ENVIRONMENTS, "Ambiente");
  const mode = requireOneOf(body.mode, MODES, "Modo");
  const terminalApp =
    mode === "terminal"
      ? requireTerminal(body.terminalApp)
      : body.terminalApp || defaultTerminal();
  const ids = Array.isArray(body.apps) ? [...new Set(body.apps)] : [];

  if (!ids.length) {
    throw new HttpError(400, "Debes seleccionar al menos un microfrontend");
  }

  const selected = ids.map(requireApp);
  const invalid = selected.flatMap((app) =>
    validateApp(app, env).map((reason) => `${app.id}: ${reason}`),
  );

  if (invalid.length) {
    throw new HttpError(
      400,
      "No se levantó ningún micro porque la selección no es válida",
      invalid,
    );
  }

  const node = resolveNode(body.node);
  const hostOverrides = buildHostOverrides(body.remotes);
  const hostId = getHostApp()?.id;
  // Remotes first so the host finds them when it compiles.
  const ordered = [
    ...selected.filter((app) => app.id !== hostId),
    ...selected.filter((app) => app.id === hostId),
  ];
  const results = [];

  for (const app of ordered) {
    const extraEnv = app.id === hostId ? hostOverrides : {};

    try {
      await processes.start(app.id, { env, mode, terminalApp, extraEnv, node });
      results.push({ id: app.id, ok: true });
    } catch (error) {
      const message = error.message.startsWith(`${app.id}:`)
        ? error.message
        : `${app.id}: ${error.message}`;

      results.push({ id: app.id, ok: false, error: message });
    }
  }

  return { results };
};

const streamLogs = (req, res) => {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
  });

  const unsubscribe = processes.subscribe(res);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
};

const serveStatic = (res, target) => {
  fs.readFile(target.full, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "No encontrado" });
      return;
    }
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": target.type,
    });
    res.end(content);
  });
};

const POST_ROUTES = {
  "/api/start": startApps,
  "/api/stop": async ({ app }) => processes.stop(requireApp(app).id),
  "/api/stop-all": async () => {
    const outcomes = await Promise.allSettled(
      getApps().map((app) => processes.stop(app.id)),
    );
    const errors = outcomes
      .filter((outcome) => outcome.status === "rejected")
      .map((outcome) => outcome.reason.message);

    return { errors };
  },
  "/api/restart": async ({ app, remotes }) => {
    const { id } = requireApp(app);
    const extraEnv =
      id === getHostApp()?.id && remotes
        ? buildHostOverrides(remotes)
        : undefined;

    await processes.restart(id, extraEnv);
  },
  "/api/clean": async ({ app, node }) =>
    processes.clean(requireApp(app).id, { node: resolveNode(node) }),
  "/api/open-terminal": async ({ app, terminalApp }) =>
    processes.openLogInTerminal(
      requireApp(app).id,
      requireTerminal(terminalApp),
    ),
  "/api/choose-directory": async () => ({ directory: await chooseDirectory() }),
  "/api/environment-files": async ({ app }) => ({
    files: readEnvironmentFiles(requireApp(app)),
  }),
  "/api/environment-files/save": async ({ app, files }) => {
    const target = requireApp(app);
    writeEnvironmentFiles(target, files);

    return { config: getConfig() };
  },
  "/api/apps": async ({ apps }) => {
    const nextApps = validateApps(apps);
    processes.assertAppsCanChange(nextApps);
    saveApps(nextApps);
    processes.syncApps(nextApps);
    return getConfig();
  },
};

const route = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET") {
    const target = staticTarget(pathname);

    if (target) {
      serveStatic(res, target);
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, getConfig());
    return;
  }

  if (req.method === "GET" && pathname === "/api/status") {
    sendJson(res, 200, { apps: processes.snapshot() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/logs") {
    streamLogs(req, res);
    return;
  }

  if (req.method === "POST" && POST_ROUTES[pathname]) {
    const body = await readJson(req);
    const result = await POST_ROUTES[pathname](body);
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  sendJson(res, 404, { error: "No encontrado" });
};

const server = http.createServer((req, res) => {
  if (!isTrustedRequest(req)) {
    sendJson(res, 403, { error: "Origen no permitido" });
    return;
  }

  route(req, res).catch((error) => {
    const status = error.status || 500;
    sendJson(res, status, { error: error.message, details: error.details });
  });
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;

  process.stdout.write(`\nLanzador de microfrontends en ${url}\n`);
  process.stdout.write(
    "Ctrl+C detiene el lanzador y los micros iniciados en modo web.\n\n",
  );

  if (process.argv.includes("--open")) {
    execFile("open", [url], () => {});
  }
});

server.on("error", (error) => {
  process.stderr.write(`No se pudo iniciar el lanzador: ${error.message}\n`);
  process.exit(1);
});

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    process.exit(1);
  }

  shuttingDown = true;
  process.stdout.write("\nDeteniendo micros en modo web...\n");

  const force = setTimeout(() => process.exit(1), 8000);

  await processes.shutdown();
  clearTimeout(force);
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown);
