// Host remotes table: env/local/custom resolution and custom remote management.

import { $, apps, el, isRunning, persist, state } from './core.js';
import { updateAll } from './main.js';

const REMOTE_MODES = ['auto', 'env', 'local', 'custom'];
const remoteRows = {};

const remoteApps = () => apps().filter((app) => app.remoteKey);
const remoteItems = () => [
  ...remoteApps(),
  ...state.customRemotes.map((remote) => ({ ...remote, custom: true })),
];
const isCustomRemoteKey = (value) => /^NEXT_PUBLIC_[A-Z0-9_]+$/.test(value || '');

const remoteChoice = (id) => {
  const choice = state.remotes[id] || {};
  return {
    mode: REMOTE_MODES.includes(choice.mode) ? choice.mode : 'auto',
    url: choice.url || '',
  };
};

const resolveMode = (remote) => {
  const { mode } = remoteChoice(remote.id);

  if (mode !== 'auto') {
    return mode;
  }

  if (remote.custom) {
    return 'env';
  }

  return state.selected.has(remote.id) || isRunning(remote.id) ? 'local' : 'env';
};

export const resolvedRemotes = () =>
  Object.fromEntries(
    remoteItems().map((remote) => [
      remote.id,
      {
        mode: resolveMode(remote),
        url: remoteChoice(remote.id).url,
        remoteKey: remote.remoteKey,
        custom: Boolean(remote.custom),
      },
    ]),
  );

const isValidUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export const addCustomRemote = () => {
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  state.customRemotes.push({
    id,
    label: 'Nuevo remote',
    remoteKey: '',
  });
  state.remotes[id] = { mode: 'local', url: 'http://localhost:3006' };
  persist();
  renderRemotes();
  updateAll();
};

const updateCustomRemote = (id, changes) => {
  state.customRemotes = state.customRemotes.map((remote) =>
    remote.id === id ? { ...remote, ...changes } : remote,
  );
  persist();
  updateAll();
};

const removeCustomRemote = (id) => {
  state.customRemotes = state.customRemotes.filter((remote) => remote.id !== id);
  delete state.remotes[id];
  persist();
  renderRemotes();
  updateAll();
};

export const renderRemotes = () => {
  Object.keys(remoteRows).forEach((id) => delete remoteRows[id]);
  $('remotes-body').replaceChildren(
    ...remoteItems().map((remote) => {
      const select = el('select', {}, [
        ...(!remote.custom ? [el('option', { value: 'auto', text: 'Automático' })] : []),
        el('option', { value: 'env', text: 'Valor del .env' }),
        el('option', {
          value: 'local',
          text: remote.custom ? 'Local (URL)' : `Local (localhost:${remote.port})`,
        }),
        el('option', { value: 'custom', text: 'Remote (URL)' }),
      ]);
      const url = el('input', {
        type: 'url',
        placeholder: 'https://…',
        spellcheck: 'false',
      });
      const envValue = el('code', { className: 'env-value' });
      const resolved = el('span', { className: 'remote-resolved' });
      const warning = el('span', { className: 'remote-warning' });
      const choice = remoteChoice(remote.id);

      select.value = choice.mode;
      url.value = choice.url;

      const save = () => {
        state.remotes[remote.id] = { mode: select.value, url: url.value.trim() };
        persist();
        updateAll();
      };

      select.addEventListener('change', save);
      url.addEventListener('input', save);

      remoteRows[remote.id] = { select, url, envValue, resolved, warning };

      const remoteName = remote.custom
        ? (() => {
            const label = el('input', {
              type: 'text',
              className: 'custom-remote-label',
              placeholder: 'Nombre del remote',
            });
            const key = el('input', {
              type: 'text',
              className: 'custom-remote-key',
              placeholder: 'NEXT_PUBLIC_REMOTE_URI',
              spellcheck: 'false',
            });
            const remove = el('button', {
              type: 'button',
              className: 'custom-remote-remove',
              text: 'Quitar',
              onClick: () => removeCustomRemote(remote.id),
            });

            label.value = remote.label;
            key.value = remote.remoteKey;
            label.addEventListener('input', () =>
              updateCustomRemote(remote.id, { label: label.value.trim() }),
            );
            key.addEventListener('input', () =>
              updateCustomRemote(remote.id, { remoteKey: key.value.trim().toUpperCase() }),
            );

            return el('div', { className: 'custom-remote-details' }, [label, key, remove]);
          })()
        : [el('strong', { text: remote.label }), el('small', { text: remote.remoteKey })];

      return el('tr', {}, [
        el('td', {}, remoteName),
        el('td', {}, [envValue]),
        el('td', { className: 'remote-choice' }, [
          el('div', { className: 'remote-inputs' }, [select, url]),
          resolved,
          warning,
        ]),
      ]);
    }),
  );
};

export const updateRemotes = () => {
  const hostSelected = Boolean(state.config.host) && state.selected.has(state.config.host);
  const hostRunning = Boolean(state.config.host) && isRunning(state.config.host);
  const uris = state.config.hostRemoteUris[state.env] || {};

  $('remotes-panel').classList.toggle('is-inactive', !hostSelected && !hostRunning);
  $('remotes-env-file').textContent = `.env.${state.env}`;
  $('remotes-hint').textContent = hostRunning
    ? 'El host en ejecución usa la configuración con la que se lanzó. «Reiniciar» en el host aplica los cambios.'
    : 'Se aplica al levantar el host, sin modificar sus archivos .env.';

  remoteItems().forEach((remote) => {
    const row = remoteRows[remote.id];
    const current = uris[remote.remoteKey];
    const mode = resolveMode(remote);
    const { url } = remoteChoice(remote.id);
    let target = current || (remote.custom ? '— sin valor en .env —' : '(vacío: el host no carga este remote)');
    let warning = '';

    row.envValue.textContent = current || (remote.custom ? '— agregado manualmente —' : '— no definido —');
    row.envValue.classList.toggle('is-local', Boolean(current && current.includes('localhost')));
    row.url.hidden = remote.custom
      ? !['local', 'custom'].includes(row.select.value)
      : row.select.value !== 'custom';

    if (mode === 'local') {
      target = remote.custom ? url || '—' : `http://localhost:${remote.port}`;
      if (!remote.custom && !state.selected.has(remote.id) && !isRunning(remote.id)) {
        warning = `${remote.label} no está seleccionado ni en ejecución`;
      } else if (remote.custom && !isValidUrl(url)) {
        warning = 'URL local no válida';
      }
    } else if (mode === 'custom') {
      target = url || '—';
      if (!isValidUrl(url)) {
        warning = 'URL no válida';
      }
    }

    if (remote.custom && !isCustomRemoteKey(remote.remoteKey)) {
      warning = 'La variable debe comenzar con NEXT_PUBLIC_';
    }

    row.resolved.textContent = `→ ${target}`;
    row.warning.textContent = warning ? `⚠ ${warning}` : '';
  });
};

export const remotesError = () =>
  state.config.host &&
  state.selected.has(state.config.host) &&
  remoteItems().some(
    (remote) =>
      (remote.custom && !isCustomRemoteKey(remote.remoteKey)) ||
      (['local', 'custom'].includes(resolveMode(remote)) &&
        remote.custom &&
        !isValidUrl(remoteChoice(remote.id).url)) ||
      (resolveMode(remote) === 'custom' &&
        !remote.custom &&
        !isValidUrl(remoteChoice(remote.id).url)),
  );
