// Editable local catalogue of microfrontends (the "Configurar micros" modal).

import { $, api, el, feedback, persist, state } from './core.js';

const registryRows = [];

const registryField = (label, input) =>
  el('label', { className: 'registry-field' }, [el('span', { text: label }), input]);

const registryInput = (value, placeholder, type = 'text') => {
  const input = el('input', { type, placeholder, autocomplete: 'off' });
  input.value = value || '';
  return input;
};

const addRegistryRow = (app = {}) => {
  const id = registryInput(app.id, 'ej. checkout');
  const label = registryInput(app.label, 'ej. Checkout');
  const directory = registryInput(app.directory, '/ruta/al/micro');
  const chooseDirectory = el('button', {
    type: 'button',
    className: 'registry-directory-picker',
    text: 'Elegir…',
  });
  const directoryControl = el('div', { className: 'registry-directory-control' }, [
    directory,
    chooseDirectory,
  ]);
  const port = registryInput(app.port, 'ej. 3006', 'number');
  port.min = '1';
  port.max = '65535';
  const buildDir = registryInput(app.buildDir, 'ej. .next');
  const remoteKey = registryInput(app.remoteKey, 'opcional');
  const isHost = el('input', { type: 'checkbox' });
  isHost.checked = Boolean(app.isHost);
  const remove = el('button', {
    type: 'button',
    className: 'registry-remove',
    text: 'Quitar',
  });
  const root = el('div', { className: 'registry-item' }, [
    registryField('ID', id),
    registryField('Nombre', label),
    registryField('Carpeta', directoryControl),
    registryField('Puerto', port),
    registryField('Build / distDir', buildDir),
    registryField('Remote env', remoteKey),
    el('label', { className: 'registry-flag' }, [isHost, el('span', { text: 'Es host' })]),
    remove,
  ]);
  const row = { root, id, label, directory, port, buildDir, remoteKey, isHost };

  chooseDirectory.addEventListener('click', async () => {
    chooseDirectory.disabled = true;

    try {
      const { directory: selectedDirectory } = await api('/api/choose-directory', {});
      directory.value = selectedDirectory;
    } catch (error) {
      if (error.message !== 'No se seleccionó una carpeta') {
        feedback(error.message, 'error', error.details);
      }
    } finally {
      chooseDirectory.disabled = false;
    }
  });

  remove.addEventListener('click', () => {
    if (registryRows.length === 1) {
      feedback('Debe quedar al menos un microfrontend configurado', 'error');
      return;
    }

    registryRows.splice(registryRows.indexOf(row), 1);
    root.remove();
  });

  registryRows.push(row);
  $('registry-list').append(root);
};

export const renderRegistry = () => {
  registryRows.splice(0, registryRows.length);
  $('registry-list').replaceChildren();
  (state.registryApps || state.config.apps).forEach(addRegistryRow);
};

const collectRegistryApps = () =>
  registryRows.map((row) => ({
    id: row.id.value.trim(),
    label: row.label.value.trim(),
    directory: row.directory.value.trim(),
    port: Number(row.port.value),
    buildDir: row.buildDir.value.trim(),
    remoteKey: row.remoteKey.value.trim(),
    isHost: row.isHost.checked,
  }));

export const updateRegistryVisibility = () => {
  const modal = $('app-registry');
  const toggle = $('registry-toggle');

  modal.hidden = !state.registryOpen;
  document.body.classList.toggle('has-open-modal', state.registryOpen);
  toggle.classList.toggle('is-active', state.registryOpen);
  toggle.setAttribute('aria-expanded', String(state.registryOpen));

  if (state.registryOpen) {
    window.requestAnimationFrame(() => $('registry-close').focus());
  }
};

export const setupRegistry = () => {
  $('registry-toggle').addEventListener('click', () => {
    state.registryOpen = true;
    updateRegistryVisibility();
  });
  $('registry-close').addEventListener('click', () => {
    state.registryOpen = false;
    updateRegistryVisibility();
    $('registry-toggle').focus();
  });
  $('app-registry').addEventListener('click', (event) => {
    if (event.target === $('app-registry')) {
      state.registryOpen = false;
      updateRegistryVisibility();
      $('registry-toggle').focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.registryOpen) {
      state.registryOpen = false;
      updateRegistryVisibility();
      $('registry-toggle').focus();
    }
  });
  $('registry-add').addEventListener('click', () => addRegistryRow());

  $('registry-save').addEventListener('click', async () => {
    const button = $('registry-save');
    button.disabled = true;

    try {
      const nextApps = collectRegistryApps();
      await api('/api/apps', { apps: nextApps });

      const ids = new Set(nextApps.map((app) => app.id));
      const remoteIds = new Set([
        ...ids,
        ...state.customRemotes.map((remote) => remote.id),
      ]);
      state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
      state.remotes = Object.fromEntries(
        Object.entries(state.remotes).filter(([id]) => remoteIds.has(id)),
      );
      state.registryApps = nextApps;
      state.registryOpen = false;
      persist();
      feedback('Configuración guardada. Actualizando el lanzador…', 'success');
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      feedback(error.message, 'error', error.details);
      button.disabled = false;
    }
  });
};
