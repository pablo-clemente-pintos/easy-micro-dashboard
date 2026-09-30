const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const ENVIRONMENTS = ['stg', 'uat', 'prod'];
const CONFIG_FILE = path.join(__dirname, '..', 'data', 'apps.json');

const DEFAULT_APPS = [
  { id: 'host', label: 'Host', directory: 'host', port: 3000, buildDir: 'host', isHost: true },
  { id: 'header-footer', label: 'Header / Footer', directory: 'header-footer', port: 3001, buildDir: 'header', remoteKey: 'NEXT_PUBLIC_HEADER_URI' },
  { id: 'home', label: 'Home', directory: 'home', port: 3002, buildDir: 'home', remoteKey: 'NEXT_PUBLIC_HOME_URI' },
  { id: 'plp', label: 'PLP', directory: 'plp', port: 3004, buildDir: 'plp', remoteKey: 'NEXT_PUBLIC_PLP_URI' },
  { id: 'pdp', label: 'PDP', directory: 'pdp', port: 3005, buildDir: 'pdp', remoteKey: 'NEXT_PUBLIC_PDP_URI' },
];

const clone = (value) => JSON.parse(JSON.stringify(value));

const loadApps = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Array.isArray(saved.apps) ? saved.apps : clone(DEFAULT_APPS);
  } catch {
    return clone(DEFAULT_APPS);
  }
};

let apps = loadApps();

const getApps = () => apps;
const getApp = (id) => apps.find((app) => app.id === id);
const getHostApp = () => apps.find((app) => app.isHost);

const appDir = (app) =>
  path.isAbsolute(app.directory)
    ? path.resolve(app.directory)
    : path.resolve(ROOT_DIR, app.directory);

const isPathInside = (candidate, parent) =>
  candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

const normalizeDirectory = (value) => String(value || '').trim().replace(/^\.\//, '');
const normalizeBuildDir = (value) => String(value || '').trim();

const validateApps = (candidate) => {
  if (!Array.isArray(candidate) || !candidate.length) {
    throw new Error('Debe existir al menos un microfrontend configurado');
  }

  const ids = new Set();
  const ports = new Set();
  let hosts = 0;

  const normalized = candidate.map((item, index) => {
    const id = String(item.id || '').trim().toLowerCase();
    const label = String(item.label || '').trim();
    const directory = normalizeDirectory(item.directory);
    const port = Number(item.port);
    const buildDir = normalizeBuildDir(item.buildDir);
    const remoteKey = String(item.remoteKey || '').trim().toUpperCase();
    const isHost = Boolean(item.isHost);
    const position = `Micro ${index + 1}`;

    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || ids.has(id)) {
      throw new Error(`${position}: el identificador debe ser único y usar minúsculas, números o guiones`);
    }
    if (!label || label.length > 60) {
      throw new Error(`${position}: indica un nombre de hasta 60 caracteres`);
    }
    if (!directory) {
      throw new Error(`${position}: indica la carpeta del microfrontend`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535 || ports.has(port)) {
      throw new Error(`${position}: el puerto debe ser único y estar entre 1 y 65535`);
    }
    const directoryPath = path.isAbsolute(directory)
      ? path.resolve(directory)
      : path.resolve(ROOT_DIR, directory);
    if (
      buildDir &&
      (path.isAbsolute(buildDir) ||
        !isPathInside(path.resolve(directoryPath, buildDir), directoryPath))
    ) {
      throw new Error(`${position}: la carpeta de build debe estar dentro del micro`);
    }
    if (remoteKey && !/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(remoteKey)) {
      throw new Error(`${position}: el remote debe comenzar con NEXT_PUBLIC_`);
    }
    if (isHost && remoteKey) {
      throw new Error(`${position}: un host no puede tener una variable remote`);
    }

    ids.add(id);
    ports.add(port);
    hosts += Number(isHost);

    return {
      id,
      label,
      directory,
      port,
      ...(buildDir ? { buildDir } : {}),
      ...(remoteKey ? { remoteKey } : {}),
      ...(isHost ? { isHost: true } : {}),
    };
  });

  if (hosts > 1) {
    throw new Error('Solo un microfrontend puede marcarse como host');
  }

  return normalized;
};

const saveApps = (candidate) => {
  const nextApps = validateApps(candidate);

  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify({ apps: nextApps }, null, 2)}\n`, 'utf8');
  apps = nextApps;
  return apps;
};

const isEnvironment = (env) => ENVIRONMENTS.includes(env);

const readScripts = (app) => {
  try {
    const raw = fs.readFileSync(path.join(appDir(app), 'package.json'), 'utf8');
    return JSON.parse(raw).scripts || {};
  } catch {
    return null;
  }
};

const validateApp = (app, env) => {
  const dir = appDir(app);

  if (!fs.existsSync(dir)) {
    return [`no existe la carpeta ${app.directory}`];
  }

  const reasons = [];
  const scripts = readScripts(app);

  if (!fs.existsSync(path.join(dir, `.env.${env}`))) {
    reasons.push(`falta .env.${env}`);
  }
  if (!scripts) {
    reasons.push('package.json ilegible');
  } else if (!Object.prototype.hasOwnProperty.call(scripts, `dev:${env}`)) {
    reasons.push(`falta el script dev:${env}`);
  }

  return reasons;
};

module.exports = {
  CONFIG_FILE,
  ENVIRONMENTS,
  ROOT_DIR,
  appDir,
  getApp,
  getApps,
  getHostApp,
  isEnvironment,
  saveApps,
  validateApp,
  validateApps,
};
