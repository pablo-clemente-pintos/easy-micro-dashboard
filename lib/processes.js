const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const { appDir, getApps, getHostApp } = require('./apps');
const { cleanCache } = require('./cache');
const { openTerminal, shellQuote } = require('./terminal');

const LOG_DIR = process.env.LAUNCHER_LOG_DIR || path.join(__dirname, '..', 'logs');
const MAX_LINES = 2000;
const POLL_INTERVAL_MS = 2000;
const TAIL_INTERVAL_MS = 300;
const KILL_TIMEOUT_MS = 5000;
const TERMINAL_GRACE_MS = 10000;

const RUNNING = ['starting', 'ready'];

const createSession = (app) => ({
  app,
  status: 'stopped',
  mode: null,
  env: null,
  pid: null,
  exitCode: null,
  message: null,
  startedAt: null,
  launch: null,
  child: null,
  logStream: null,
  stopping: false,
  killTimer: null,
  exitWaiters: [],
  tail: null,
  lines: [],
  partial: '',
  cleaning: false,
  // Cache was cleaned while this app was running: it must be restarted to
  // pick up the change. Cleared on the next successful start.
  staleAfterClean: false,
});

const sessions = new Map(getApps().map((app) => [app.id, createSession(app)]));

// Single SSE stream for every app: browsers cap HTTP/1.1 connections per host.
const subscribers = new Set();

fs.mkdirSync(LOG_DIR, { recursive: true });

const logPath = (id) => path.join(LOG_DIR, `${id}.log`);

const clearLogFile = (id) => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(logPath(id), '');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getSession = (id) => {
  const session = sessions.get(id);

  if (!session) {
    throw new Error(`App desconocida: ${id}`);
  }

  return session;
};

const sessionIsActive = (session) =>
  Boolean(session.child) || RUNNING.includes(session.status);

const assertAppsCanChange = (nextApps) => {
  const nextById = new Map(nextApps.map((app) => [app.id, app]));

  sessions.forEach((session, id) => {
    if (!sessionIsActive(session)) {
      return;
    }

    const next = nextById.get(id);

    if (!next) {
      throw new Error(`No se puede quitar ${id} mientras está en ejecución`);
    }
    if (next.directory !== session.app.directory || next.port !== session.app.port) {
      throw new Error(`Detén ${id} antes de cambiar su carpeta o puerto`);
    }
  });
};

const syncApps = (nextApps) => {
  assertAppsCanChange(nextApps);
  const nextIds = new Set(nextApps.map((app) => app.id));

  sessions.forEach((session, id) => {
    if (!nextIds.has(id)) {
      sessions.delete(id);
    }
  });

  nextApps.forEach((app) => {
    const session = sessions.get(app.id);

    if (session) {
      session.app = app;
    } else {
      sessions.set(app.id, createSession(app));
    }
  });
};

const probeHost = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

const isPortOpen = async (port) =>
  (await probeHost('127.0.0.1', port)) || probeHost('::1', port);

// A held TCP port is not the same as a usable dev server: next dev opens the
// port before the first compile finishes, and a crashed leftover can keep it.
// "ready" requires an actual HTTP response (any status counts as serving).
const HTTP_PROBE_TIMEOUT_MS = 1500;

const httpResponds = (port) =>
  new Promise((resolve) => {
    const request = http.request(
      { host: '127.0.0.1', port, method: 'HEAD', path: '/', timeout: HTTP_PROBE_TIMEOUT_MS },
      (res) => {
        res.resume();
        resolve(true);
      },
    );

    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
    request.end();
  });

const waitForPortClosed = async (port, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;

  while ((await isPortOpen(port)) && Date.now() < deadline) {
    await wait(300);
  }
};

/* ----------------------------------------------------------------------- */
/* Logs                                                                     */
/* ----------------------------------------------------------------------- */

const broadcast = (session, event, data) => {
  const payload = JSON.stringify({ app: session.app.id, ...data });
  subscribers.forEach((res) => res.write(`event: ${event}\ndata: ${payload}\n\n`));
};

// Keeps only what remains visible after carriage returns (spinners, etc.).
const normalizeLine = (line) => {
  const clean = line.replace(/\r$/, '');
  const index = clean.lastIndexOf('\r');
  return index >= 0 ? clean.slice(index + 1) : clean;
};

const pushLines = (session, lines) => {
  if (!lines.length) {
    return;
  }

  session.lines.push(...lines);

  if (session.lines.length > MAX_LINES) {
    session.lines.splice(0, session.lines.length - MAX_LINES);
  }

  broadcast(session, 'lines', { lines });
};

const pushText = (session, text) => {
  const parts = (session.partial + text).split('\n');
  session.partial = parts.pop();
  pushLines(session, parts.map(normalizeLine));
};

const flushPartial = (session) => {
  if (session.partial) {
    pushLines(session, [normalizeLine(session.partial)]);
    session.partial = '';
  }
};

const system = (session, message, color = 36) => {
  const line = `\u001b[${color}m[launcher] ${message}\u001b[0m`;

  session.logStream?.write(`${line}\n`);
  flushPartial(session);
  pushLines(session, [line]);
};

const resetLogs = (session) => {
  session.lines = [];
  session.partial = '';
  broadcast(session, 'reset', {});
};

const subscribe = (res) => {
  const buffers = Object.fromEntries(
    [...sessions.values()].map((session) => [session.app.id, session.lines]),
  );

  res.write(`event: init\ndata: ${JSON.stringify(buffers)}\n\n`);
  subscribers.add(res);

  return () => subscribers.delete(res);
};

/* ----------------------------------------------------------------------- */
/* Web mode: the launcher owns the process                                  */
/* ----------------------------------------------------------------------- */

const finishManaged = (session, { status, message, exitCode = null }) => {
  flushPartial(session);
  Object.assign(session, { status, message, exitCode });
  system(session, message, status === 'error' ? 31 : 36);

  clearTimeout(session.killTimer);
  const logStream = session.logStream;
  Object.assign(session, {
    child: null,
    logStream: null,
    pid: null,
    stopping: false,
    killTimer: null,
  });

  const resolveExitWaiters = () => {
    session.exitWaiters.forEach((resolve) => resolve());
    session.exitWaiters = [];
  };

  // Wait for the final write to reach disk before stop() truncates the file.
  if (logStream) {
    logStream.end(resolveExitWaiters);
  } else {
    resolveExitWaiters();
  }
};

// The selected Node goes first in PATH, so `#!/usr/bin/env node` (yarn, next,
// dotenv...) resolves to it while yarn itself can still come from the PATH.
const withNodePath = (node) => `${node.bin}${path.delimiter}${process.env.PATH || ''}`;

// @module-federation/nextjs-mf refuses to compile without it. host/home set it
// in next:dev, but the dev:<env> scripts of header-footer, plp and pdp rely on
// it being exported in the shell. A value already in the environment wins.
const DEFAULT_ENV = { NEXT_PRIVATE_LOCAL_WEBPACK: 'true' };

const defaultEnv = () =>
  Object.fromEntries(
    Object.entries(DEFAULT_ENV).filter(([key]) => process.env[key] === undefined),
  );

const startManaged = (session, { env, extraEnv, node }) => {
  const { app } = session;

  fs.mkdirSync(LOG_DIR, { recursive: true });
  clearLogFile(app.id);
  // Append mode keeps the file position correct if a cache clean truncates a
  // log while its dev server is still running.
  session.logStream = fs.createWriteStream(logPath(app.id), { flags: 'a' });
  // Losing the log file must never take the launcher down.
  session.logStream.on('error', (error) => {
    session.logStream = null;
    system(session, `No se pudo escribir el log: ${error.message}`, 33);
  });

  const child = spawn('yarn', [`dev:${env}`], {
    cwd: appDir(app),
    detached: true,
    env: {
      ...defaultEnv(),
      ...process.env,
      FORCE_COLOR: '1',
      ...extraEnv,
      PATH: withNodePath(node),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  session.child = child;
  session.pid = child.pid ?? null;

  const onData = (chunk) => {
    session.logStream?.write(chunk);
    pushText(session, chunk.toString('utf8'));
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.once('error', (error) => {
    // Spawn failures (e.g. yarn not in PATH) never emit 'close'.
    if (!child.pid) {
      finishManaged(session, {
        status: 'error',
        message: `No se pudo iniciar: ${error.message}`,
      });
    }
  });

  // 'close' fires once stdio is drained, so no output is lost.
  child.once('close', (code, signal) => {
    if (session.child !== child) {
      return;
    }

    // A dev server never ends on its own: even code 0 means it crashed.
    const requested = session.stopping;

    finishManaged(session, {
      status: requested ? 'exited' : 'error',
      exitCode: code,
      message: requested
        ? 'Detenido desde el lanzador'
        : `El proceso terminó inesperadamente (${signal || `código ${code}`}). Revisa la consola.`,
    });
  });
};

const stopManaged = (session) =>
  new Promise((resolve) => {
    const { child } = session;

    session.exitWaiters.push(resolve);

    if (session.stopping) {
      return;
    }

    session.stopping = true;
    system(session, 'Deteniendo...');

    // Negative pid: signal the whole group (yarn → dotenv → next).
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Group already gone.
      }
    };

    kill('SIGTERM');
    session.killTimer = setTimeout(() => kill('SIGKILL'), KILL_TIMEOUT_MS);
  });

/* ----------------------------------------------------------------------- */
/* Terminal mode: native Terminal/iTerm window recorded with script(1)      */
/* ----------------------------------------------------------------------- */

const stopTail = (session) => {
  clearInterval(session.tail);
  session.tail = null;
};

const tailFile = (session, file) => {
  let position = 0;
  let reading = false;

  stopTail(session);

  session.tail = setInterval(() => {
    if (reading) {
      return;
    }

    reading = true;

    fs.stat(file, (statError, stats) => {
      if (statError || stats.size === position) {
        reading = false;
        return;
      }

      if (stats.size < position) {
        position = 0;
      }

      const stream = fs.createReadStream(file, { start: position });

      position = stats.size;
      stream.on('data', (chunk) => pushText(session, chunk.toString('utf8')));
      stream.on('close', () => {
        reading = false;
      });
    });
  }, TAIL_INTERVAL_MS);
};

const findRecorderPid = (file) =>
  new Promise((resolve) => {
    execFile('pgrep', ['-f', `script -q -F ${file}`], (error, stdout) => {
      const pid = Number.parseInt(stdout, 10);
      resolve(error || Number.isNaN(pid) ? null : pid);
    });
  });

const startInTerminal = async (session, { env, extraEnv, node, terminalApp }) => {
  const { app } = session;
  const file = logPath(app.id);
  const exports = Object.entries({ ...defaultEnv(), ...extraEnv }).map(
    ([key, value]) => `export ${key}=${shellQuote(value)} && `,
  );
  const command = [
    `cd ${shellQuote(appDir(app))} && `,
    `export PATH=${shellQuote(node.bin)}:"$PATH" && `,
    ...exports,
    `exec script -q -F ${shellQuote(file)} yarn ${shellQuote(`dev:${env}`)}`,
  ].join('');

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(file, '');
  await openTerminal(terminalApp, command);
  tailFile(session, file);
};

const finishTerminal = (session, message) => {
  flushPartial(session);
  Object.assign(session, { status: 'exited', message, pid: null });
  system(session, message);

  // Keep reading briefly to capture the last lines written by script(1).
  setTimeout(() => {
    if (!RUNNING.includes(session.status)) {
      stopTail(session);
    }
  }, 1500);
};

/* ----------------------------------------------------------------------- */
/* Public API                                                               */
/* ----------------------------------------------------------------------- */

const isAlive = (session) =>
  Boolean(session.child) ||
  (session.mode === 'terminal' && RUNNING.includes(session.status));

const describeLaunch = ({ env, mode, extraEnv, node }, app) => {
  const where = mode === 'terminal' ? 'Terminal nativa' : 'web';
  const overrides = Object.entries({ ...defaultEnv(), ...extraEnv })
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  return (
    `yarn dev:${env} en ${app.id} (${where}, Node ${node.version})` +
    (overrides ? ` · ${overrides}` : '')
  );
};

const start = async (id, launch) => {
  const session = getSession(id);
  const { app } = session;

  if (isAlive(session)) {
    throw new Error(`${app.id} ya está en ejecución`);
  }

  if (await isPortOpen(app.port)) {
    session.status = 'port-busy';
    session.message = `El puerto ${app.port} ya está en uso`;
    throw new Error(`${app.id}: ${session.message}`);
  }

  stopTail(session);
  resetLogs(session);

  Object.assign(session, {
    status: 'starting',
    mode: launch.mode,
    env: launch.env,
    pid: null,
    exitCode: null,
    message: null,
    startedAt: Date.now(),
    staleAfterClean: false,
    launch,
  });

  system(session, describeLaunch(launch, app));

  if (launch.mode !== 'terminal') {
    startManaged(session, launch);
    return;
  }

  try {
    await startInTerminal(session, launch);
  } catch (error) {
    session.status = 'error';
    session.message = `No se pudo abrir la terminal: ${error.message}`;
    system(session, session.message, 31);
    throw error;
  }
};

const stop = async (id) => {
  const session = getSession(id);

  if (session.child) {
    await stopManaged(session);
    clearLogFile(session.app.id);
    return;
  }

  if (session.mode !== 'terminal' || !RUNNING.includes(session.status)) {
    return;
  }

  if (!session.pid) {
    throw new Error(`${id}: todavía no se detectó el proceso de la Terminal`);
  }

  // Ending script(1) hangs up its pty, which terminates yarn and next.
  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }

  finishTerminal(session, 'Detenido desde el lanzador');
  clearLogFile(session.app.id);
};

// extraEnv, when given, replaces the env overrides of the previous launch.
const restart = async (id, extraEnv) => {
  const session = getSession(id);

  if (!session.launch) {
    throw new Error(`${id} no se lanzó desde el lanzador`);
  }

  if (extraEnv) {
    session.launch = { ...session.launch, extraEnv };
  }

  await stop(id);
  await waitForPortClosed(session.app.port, KILL_TIMEOUT_MS);
  await start(id, session.launch);
};

const openLogInTerminal = (id, terminalApp) => {
  const file = logPath(getSession(id).app.id);
  return openTerminal(terminalApp, `tail -n 300 -f ${shellQuote(file)}`);
};

const isRunning = (session) =>
  Boolean(session.child) || RUNNING.includes(session.status);

// Per-app clean-home-host.sh. If the app (or the running host that consumes it)
// is up, it is flagged stale so the UI can prompt for a restart.
const clean = async (id, { node }) => {
  const session = getSession(id);

  if (session.cleaning) {
    throw new Error(`${id}: ya se está limpiando la caché`);
  }

  session.cleaning = true;
  clearLogFile(session.app.id);
  const wasRunning = isRunning(session);
  const host = getHostApp();
  const hostSession = host ? sessions.get(host.id) : null;
  const hostWasRunning =
    Boolean(hostSession) && id !== host?.id && isRunning(hostSession);

  system(session, `Limpiando caché de ${session.app.id}...`, 33);

  try {
    await cleanCache(session.app, {
      env: { ...defaultEnv(), ...process.env, PATH: withNodePath(node) },
      onStep: (step) => system(session, step, 33),
      onOutput: (text) => pushText(session, text),
    });
  } catch (error) {
    system(session, `Error al limpiar la caché: ${error.message}`, 31);
    session.cleaning = false;
    throw error;
  }

  system(session, 'Caché limpiada.', 32);

  if (wasRunning) {
    session.staleAfterClean = true;
    system(session, 'Reinicia este micro para tomar los cambios.', 33);
  }

  if (hostWasRunning) {
    hostSession.staleAfterClean = true;
    system(hostSession, `Se limpió la caché de ${session.app.id}. Reinicia el host.`, 33);
  }

  session.cleaning = false;

  return {
    stale: [
      wasRunning && session.app.id,
      hostWasRunning && host.id,
    ].filter(Boolean),
  };
};

const snapshot = () =>
  [...sessions.values()].map((session) => ({
    id: session.app.id,
    status: session.status,
    mode: session.mode,
    env: session.env,
    node: session.launch?.node.version ?? null,
    pid: session.pid,
    exitCode: session.exitCode,
    message: session.message,
    startedAt: session.startedAt,
    cleaning: session.cleaning,
    staleAfterClean: session.staleAfterClean,
    canRestart: Boolean(session.launch) && session.status !== 'port-busy',
  }));

const refreshTerminalSession = async (session, open) => {
  const pid = await findRecorderPid(logPath(session.app.id));

  if (!RUNNING.includes(session.status)) {
    return;
  }

  if (pid) {
    session.pid = pid;
    session.status = open && (await httpResponds(session.app.port)) ? 'ready' : 'starting';
    return;
  }

  // The window may not have spawned script(1) yet.
  if (Date.now() - session.startedAt > TERMINAL_GRACE_MS) {
    finishTerminal(session, 'La ventana de Terminal terminó');
  }
};

const refreshSession = async (session) => {
  const open = await isPortOpen(session.app.port);

  if (session.child) {
    if (session.status === 'starting' && open && (await httpResponds(session.app.port))) {
      session.status = 'ready';
    }
    return;
  }

  if (session.mode === 'terminal' && RUNNING.includes(session.status)) {
    await refreshTerminalSession(session, open);
    return;
  }

  if (open && session.status !== 'port-busy') {
    session.status = 'port-busy';
    session.message = `Puerto ${session.app.port} ocupado por otro proceso`;
  } else if (!open && session.status === 'port-busy') {
    session.status = 'stopped';
    session.message = null;
  }
};

let polling = false;

const poll = async () => {
  if (polling) {
    return;
  }

  polling = true;
  await Promise.all([...sessions.values()].map(refreshSession));
  polling = false;
};

poll();
setInterval(poll, POLL_INTERVAL_MS).unref();

// Only processes owned by the launcher; native Terminal windows stay alive.
const shutdown = () =>
  Promise.all(
    [...sessions.values()]
      .filter((session) => session.child)
      .map((session) => stop(session.app.id)),
  );

module.exports = {
  clean,
  assertAppsCanChange,
  openLogInTerminal,
  restart,
  shutdown,
  snapshot,
  start,
  stop,
  subscribe,
  syncApps,
};
