// Live console: per-app log tabs, streaming, filtering and toolbar actions.

import { $, api, apps, el, feedback, persist, state, statusOf } from './core.js';

const MAX_LINES = 2000;
const tabs = {};

const consoleEl = () => $('console');

const matches = (line) =>
  !state.filter || window.Ansi.strip(line).toLowerCase().includes(state.filter);

const lineNode = (line) => {
  const node = el('div', { className: 'line' });
  node.innerHTML = window.Ansi.toHtml(line);
  return node;
};

const scrollToBottom = () => {
  const box = consoleEl();
  box.scrollTop = box.scrollHeight;
};

export const renderConsole = () => {
  const lines = state.logs[state.activeTab] || [];
  const fragment = document.createDocumentFragment();

  lines.filter(matches).forEach((line) => fragment.append(lineNode(line)));
  consoleEl().replaceChildren(fragment);

  if (!lines.length) {
    consoleEl().append(
      el('div', {
        className: 'console-empty',
        text: 'Sin salida todavía. Levanta el micro para ver su consola aquí.',
      }),
    );
  }

  state.follow = true;
  $('console-follow').hidden = true;
  scrollToBottom();
};

const appendLines = (lines) => {
  const box = consoleEl();

  box.querySelector('.console-empty')?.remove();
  lines.filter(matches).forEach((line) => box.append(lineNode(line)));

  while (box.childElementCount > MAX_LINES) {
    box.firstElementChild.remove();
  }

  if (state.follow) {
    scrollToBottom();
  }
};

const storeLines = (id, lines) => {
  const buffer = (state.logs[id] = (state.logs[id] || []).concat(lines));

  if (buffer.length > MAX_LINES) {
    buffer.splice(0, buffer.length - MAX_LINES);
  }
};

export const renderTabs = () => {
  $('tabs').replaceChildren(
    ...apps().map((app) => {
      const dot = el('span', { className: 'tab-dot' });
      const unread = el('span', { className: 'tab-unread' });
      const button = el(
        'button',
        { type: 'button', role: 'tab', onClick: () => selectTab(app.id) },
        [dot, el('span', { text: app.label }), unread],
      );

      tabs[app.id] = { button, dot, unread };
      return button;
    }),
  );
};

export const updateTabs = () => {
  apps().forEach((app) => {
    const tab = tabs[app.id];
    const active = app.id === state.activeTab;

    tab.button.classList.toggle('is-active', active);
    tab.button.setAttribute('aria-selected', String(active));
    tab.dot.className = `tab-dot status-${statusOf(app.id).status}`;
    tab.unread.hidden = !state.unread.has(app.id);
  });

  const status = statusOf(state.activeTab);
  const info =
    status.mode === 'terminal'
      ? 'Espejo de la ventana de Terminal (solo lectura)'
      : status.mode === 'web'
        ? `Log completo en launcher/logs/${state.activeTab}.log`
        : '';

  $('console-info').textContent = info;
  $('console-terminal').disabled = status.mode !== 'web';
};

export const selectTab = (id) => {
  state.activeTab = id;
  state.unread.delete(id);
  persist();
  updateTabs();
  renderConsole();
};

export const connectLogs = () => {
  const source = new EventSource('/api/logs');

  source.addEventListener('init', (event) => {
    state.logs = JSON.parse(event.data);
    renderConsole();
  });

  source.addEventListener('lines', (event) => {
    const { app, lines } = JSON.parse(event.data);

    storeLines(app, lines);

    if (app === state.activeTab) {
      appendLines(lines);
    } else {
      state.unread.add(app);
      updateTabs();
    }
  });

  source.addEventListener('reset', (event) => {
    const { app } = JSON.parse(event.data);

    state.logs[app] = [];
    if (app === state.activeTab) {
      renderConsole();
    }
  });
};

export const setupConsoleControls = () => {
  const box = consoleEl();
  const followButton = $('console-follow');

  box.addEventListener('scroll', () => {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
    state.follow = atBottom;
    followButton.hidden = atBottom;
  });

  followButton.addEventListener('click', () => {
    state.follow = true;
    followButton.hidden = true;
    scrollToBottom();
  });

  $('console-filter').addEventListener('input', (event) => {
    state.filter = event.target.value.trim().toLowerCase();
    renderConsole();
  });

  $('console-clear').addEventListener('click', () => {
    state.logs[state.activeTab] = [];
    renderConsole();
  });

  $('console-copy').addEventListener('click', async () => {
    const text = (state.logs[state.activeTab] || [])
      .map(window.Ansi.strip)
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      feedback('Consola copiada al portapapeles', 'success');
    } catch (error) {
      feedback(`No se pudo copiar: ${error.message}`, 'error');
    }
  });

  $('console-terminal').addEventListener('click', async () => {
    try {
      await api('/api/open-terminal', {
        app: state.activeTab,
        terminalApp: state.terminalApp,
      });
    } catch (error) {
      feedback(error.message, 'error');
    }
  });
};
