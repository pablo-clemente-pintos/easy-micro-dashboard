// Shared state, DOM helpers, API client and app accessors used by every module.

export const RUNNING = ['starting', 'ready'];
const STORAGE_KEY = 'mf-launcher';

const loadSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
};

const saved = loadSaved();

export const state = {
  config: null,
  env: saved.env || 'stg',
  mode: saved.mode || 'web',
  terminalApp: saved.terminalApp || null,
  node: saved.node || null,
  selected: new Set(saved.selected || []),
  remotes: saved.remotes || {},
  customRemotes: Array.isArray(saved.customRemotes) ? saved.customRemotes : [],
  activeTab: saved.activeTab || 'host',
  sidebarCollapsed: Boolean(saved.sidebarCollapsed),
  registryApps: Array.isArray(saved.registryApps) ? saved.registryApps : null,
  registryOpen: !Array.isArray(saved.registryApps),
  activeView: ['services', 'remotes', 'console'].includes(saved.activeView)
    ? saved.activeView
    : 'services',
  status: {},
  logs: {},
  unread: new Set(),
  follow: true,
  filter: '',
  offline: false,
};

export const persist = () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      env: state.env,
      mode: state.mode,
      terminalApp: state.terminalApp,
      node: state.node,
      selected: [...state.selected],
      remotes: state.remotes,
      customRemotes: state.customRemotes,
      activeTab: state.activeTab,
      sidebarCollapsed: state.sidebarCollapsed,
      registryApps: state.registryApps,
      activeView: state.activeView,
    }),
  );
};

export const $ = (id) => document.getElementById(id);

export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);

  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key.startsWith('on')) {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value);
    }
  });

  [].concat(children).forEach((child) => child && node.append(child));
  return node;
};

export const api = async (path, body) => {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error || `Error ${response.status}`);
    error.details = payload.details;
    throw error;
  }

  return payload;
};

export const apps = () => state.config.apps;
export const getApp = (id) => apps().find((app) => app.id === id);
export const statusOf = (id) => state.status[id] || { status: 'stopped' };
export const isRunning = (id) => RUNNING.includes(statusOf(id).status);
export const reasonsFor = (app) => app.invalid[state.env] || [];
export const isValid = (app) => reasonsFor(app).length === 0;
export const selectedApps = () =>
  apps().filter((app) => state.selected.has(app.id) && isValid(app));
export const selectedNode = () =>
  state.config.nodeVersions.find((item) => item.id === state.node);

let feedbackTimer = null;

export const feedback = (message, type = 'info', details = []) => {
  const box = $('feedback');

  clearTimeout(feedbackTimer);
  box.className = `feedback feedback-${type}`;
  box.replaceChildren(
    el('strong', { text: message }),
    ...(details.length
      ? [el('ul', {}, details.map((detail) => el('li', { text: detail })))]
      : []),
  );

  if (type === 'success') {
    feedbackTimer = setTimeout(() => box.replaceChildren(), 8000);
  }
};
