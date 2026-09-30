// Editor for each microfrontend's environment files. Content stays raw so
// comments, quotes and the original variable order are preserved.

import { $, api, el, feedback, state } from './core.js';
import { updateAll } from './main.js';

const ENVIRONMENTS = ['stg', 'uat', 'prod'];
let activeApp = null;
let fields = {};

const closeEditor = (restoreFocus = true) => {
  const modal = $('environment-editor');
  modal.hidden = true;
  document.body.classList.remove('has-open-modal');

  if (restoreFocus && activeApp) {
    document.querySelector(`[data-environment-app="${activeApp.id}"]`)?.focus();
  }
};

const renderFiles = (files) => {
  fields = {};
  const editor = $('environment-files');

  editor.replaceChildren(
    ...ENVIRONMENTS.map((env) => {
      const file = files[env];
      const textarea = el('textarea', {
        id: `environment-${env}`,
        spellcheck: 'false',
        placeholder: '# NEXT_PUBLIC_API_URL=https://…',
        'aria-label': `Contenido de .env.${env}`,
      });
      textarea.value = file.content;
      fields[env] = textarea;

      return el('section', { className: 'environment-file' }, [
        el('div', { className: 'environment-file-header' }, [
          el('strong', { text: `.env.${env}` }),
          el('span', {
            className: file.exists ? 'environment-exists' : 'environment-missing',
            text: file.exists ? 'Disponible' : 'Se creará al guardar',
          }),
        ]),
        textarea,
      ]);
    }),
  );
};

export const openEnvironmentEditor = async (app) => {
  activeApp = app;
  const modal = $('environment-editor');
  const save = $('environment-save');

  $('environment-editor-title').textContent = `Variables de entorno · ${app.label}`;
  $('environment-editor-description').textContent =
    `Edita los archivos de ${app.directory}. Los que falten se crearán al guardar.`;
  $('environment-files').replaceChildren(
    el('p', { className: 'environment-loading', text: 'Cargando archivos…' }),
  );
  save.disabled = true;
  modal.hidden = false;
  document.body.classList.add('has-open-modal');

  try {
    const { files } = await api('/api/environment-files', { app: app.id });

    if (activeApp?.id !== app.id || modal.hidden) {
      return;
    }

    renderFiles(files);
    save.disabled = false;
    window.requestAnimationFrame(() => fields.stg.focus());
  } catch (error) {
    closeEditor(false);
    feedback(error.message, 'error', error.details);
  }
};

const saveEnvironmentFiles = async () => {
  if (!activeApp) {
    return;
  }

  const save = $('environment-save');
  save.disabled = true;

  try {
    const { config } = await api('/api/environment-files/save', {
      app: activeApp.id,
      files: Object.fromEntries(ENVIRONMENTS.map((env) => [env, fields[env].value])),
    });

    state.config = config;
    updateAll();
    const app = activeApp;
    closeEditor();
    feedback(`Variables de entorno de ${app.label} guardadas`, 'success');
  } catch (error) {
    feedback(error.message, 'error', error.details);
    save.disabled = false;
  }
};

export const setupEnvironmentEditor = () => {
  $('environment-close').addEventListener('click', () => closeEditor());
  $('environment-save').addEventListener('click', saveEnvironmentFiles);
  $('environment-editor').addEventListener('click', (event) => {
    if (event.target === $('environment-editor')) {
      closeEditor();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('environment-editor').hidden) {
      closeEditor();
    }
  });
};
