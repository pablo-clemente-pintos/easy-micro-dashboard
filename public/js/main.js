// Entry point: assembles the modules, drives the status loop and boots the UI.

import {
  $,
  api,
  apps,
  feedback,
  getApp,
  isRunning,
  isValid,
  persist,
  selectedApps,
  state,
} from './core.js';
import { renderCards, startSelected, updateCard } from './cards.js';
import {
  addCustomRemote,
  remotesError,
  renderRemotes,
  updateRemotes,
} from './remotes.js';
import {
  connectLogs,
  renderConsole,
  renderTabs,
  setupConsoleControls,
  updateTabs,
} from './console.js';
import { renderEnvSelector, setupModeControls, warnIfOldNode } from './selectors.js';
import { setupSidebar, setupViews } from './layout.js';
import { renderRegistry, setupRegistry, updateRegistryVisibility } from './registry.js';
import { setupEnvironmentEditor } from './environment-editor.js';

const STATUS_INTERVAL_MS = 1500;

const updateMicroStatus = () => {
  const count = apps().filter((app) => isRunning(app.id)).length;
  const status = $('micro-status');

  status.classList.toggle('is-running', count > 0);
  status.classList.toggle('is-idle', count === 0);
  $('micro-status-title').textContent =
    count > 0 ? 'Micros en ejecución' : 'No hay micros en ejecución';
  $('micro-status-detail').textContent =
    count > 0 ? 'Servicios locales activos' : 'Selecciona un micro para iniciar';
};

export const updateAll = () => {
  apps().forEach(updateCard);
  updateRemotes();
  updateTabs();

  const startButton = $('start-selected');
  startButton.disabled = !selectedApps().length || remotesError();
  $('stop-all').disabled = !apps().some((app) => isRunning(app.id));
  updateMicroStatus();
};

const stopAll = async () => {
  try {
    const { errors } = await api('/api/stop-all', {});

    if (errors.length) {
      feedback('Algunos micros no se detuvieron', 'error', errors);
    } else {
      feedback('Micros detenidos', 'success');
    }
  } catch (error) {
    feedback(error.message, 'error');
  } finally {
    pollStatus();
  }
};

const setupActions = () => {
  $('start-selected').addEventListener('click', startSelected);
  $('stop-all').addEventListener('click', stopAll);
  $('remotes-add').addEventListener('click', addCustomRemote);

  $('select-all').addEventListener('click', () => {
    apps().filter(isValid).forEach((app) => state.selected.add(app.id));
    persist();
    updateAll();
  });

  $('select-none').addEventListener('click', () => {
    state.selected.clear();
    persist();
    updateAll();
  });
};

let statusTimer = null;

export const pollStatus = async () => {
  clearTimeout(statusTimer);

  try {
    const { apps: list } = await api('/api/status');

    state.status = Object.fromEntries(list.map((item) => [item.id, item]));

    if (state.offline) {
      state.offline = false;
      feedback('Conexión con el lanzador restablecida', 'success');
    }

    updateAll();
  } catch {
    if (!state.offline) {
      state.offline = true;
      feedback('Sin conexión con el lanzador. ¿Sigue corriendo node server.js?', 'error');
    }
  }

  statusTimer = setTimeout(pollStatus, STATUS_INTERVAL_MS);
};

const boot = async () => {
  try {
    state.config = await api('/api/config');
  } catch (error) {
    feedback(`No se pudo cargar la configuración: ${error.message}`, 'error');
    return;
  }

  if (state.registryApps?.length) {
    try {
      state.config = await api('/api/apps', { apps: state.registryApps });
    } catch {
      // Keep the local catalogue intact so it can be retried or corrected
      // after restarting the launcher, while exposing the editor.
      state.registryOpen = true;
      persist();
    }
  }

  if (!state.config.environments.includes(state.env)) {
    state.env = state.config.environments[0];
  }
  const installedTerminal = state.config.terminals.some(
    (terminal) => terminal.id === state.terminalApp && terminal.installed,
  );

  if (!installedTerminal) {
    state.terminalApp = state.config.defaultTerminal;
  }
  if (!state.config.nodeVersions.some((item) => item.id === state.node)) {
    state.node = state.config.defaultNode;
  }
  if (!getApp(state.activeTab)) {
    state.activeTab = apps()[0].id;
  }

  renderEnvSelector();
  setupSidebar();
  setupViews();
  setupModeControls();
  renderCards();
  renderRegistry();
  renderRemotes();
  renderTabs();
  setupConsoleControls();
  setupActions();
  setupRegistry();
  setupEnvironmentEditor();
  updateRegistryVisibility();
  updateAll();
  renderConsole();
  connectLogs();
  pollStatus();
  warnIfOldNode();
};

// The guard lets the module graph be imported in Node for resolution checks
// without triggering a browser-only boot.
if (typeof document !== 'undefined') {
  boot();
}
