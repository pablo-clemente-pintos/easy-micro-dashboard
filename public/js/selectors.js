// Top-bar run controls: environment, Node version, console mode and terminal app.

import { $, el, feedback, persist, selectedNode, state } from './core.js';
import { updateAll } from './main.js';

export const renderEnvSelector = () => {
  const container = $('env-selector');

  container.replaceChildren(
    ...state.config.environments.map((env) => {
      const input = el('input', { type: 'radio', name: 'env', value: env });

      input.checked = env === state.env;
      input.addEventListener('change', () => {
        state.env = env;
        persist();
        updateAll();
      });

      return el('label', {}, [input, el('span', { text: env.toUpperCase() })]);
    }),
  );
};

export const warnIfOldNode = () => {
  const node = selectedNode();

  if (node && !node.recommended) {
    feedback(
      `Node ${node.version} es anterior a 20.12: @module-federation usa util.styleText y next dev fallará al iniciar.`,
      'error',
    );
  }
};

export const setupModeControls = () => {
  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.checked = input.value === state.mode;
    input.addEventListener('change', () => {
      state.mode = input.value;
      persist();
    });
  });

  const terminalSelect = $('terminal-app');

  terminalSelect.replaceChildren(
    ...state.config.terminals.map((terminal) => {
      const option = el('option', {
        value: terminal.id,
        text: terminal.installed ? terminal.label : `${terminal.label} (no instalado)`,
      });

      option.disabled = !terminal.installed;
      return option;
    }),
  );
  terminalSelect.value = state.terminalApp;
  terminalSelect.addEventListener('change', () => {
    state.terminalApp = terminalSelect.value;
    persist();
  });

  const nodeSelect = $('node-version');

  nodeSelect.replaceChildren(
    ...state.config.nodeVersions.map((item) =>
      el('option', {
        value: item.id,
        text:
          item.id === 'current'
            ? `${item.version} (la del lanzador)`
            : `${item.version}${item.recommended ? '' : ' ⚠'}`,
      }),
    ),
  );
  nodeSelect.value = state.node;
  nodeSelect.addEventListener('change', () => {
    state.node = nodeSelect.value;
    persist();
    warnIfOldNode();
  });
};
