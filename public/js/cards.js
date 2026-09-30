// Microfrontend cards: rendering, per-card actions and bulk/single launch.

import {
  $,
  api,
  apps,
  el,
  feedback,
  isRunning,
  isValid,
  persist,
  reasonsFor,
  selectedApps,
  state,
  statusOf,
} from './core.js';
import { selectTab } from './console.js';
import { openEnvironmentEditor } from './environment-editor.js';
import { updateActiveView } from './layout.js';
import { resolvedRemotes } from './remotes.js';
import { pollStatus, updateAll } from './main.js';

const STATUS_LABELS = {
  stopped: 'Detenido',
  starting: 'Iniciando…',
  ready: 'Listo',
  exited: 'Finalizado',
  error: 'Error',
  'port-busy': 'Puerto ocupado',
};
const cards = {};
const CARD_DETAILS = {
  host: { icon: '⬡' },
  'header-footer': { icon: '▱' },
  home: { icon: '⌂' },
  plp: { icon: '◇' },
  pdp: { icon: '▣' },
};

const closeCardMenus = (except = null) => {
  Object.values(cards).forEach((card) => {
    if (card.more !== except) {
      card.more.open = false;
      card.root.classList.remove('is-menu-open');
    }
  });
};

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.card-more')) {
    closeCardMenus();
  }
});

const runAction = async (action, id) => {
  try {
    const body = { app: id };

    if (action === 'restart' && id === state.config.host) {
      body.remotes = resolvedRemotes();
    }

    await api(`/api/${action}`, body);
    pollStatus();
  } catch (error) {
    feedback(error.message, 'error', error.details);
  }
};

const cleanCache = async (id) => {
  selectTab(id);
  // Optimistic lock so the button disables before the next status poll.
  state.status[id] = { ...statusOf(id), cleaning: true };
  updateAll();

  try {
    const { stale } = await api('/api/clean', { app: id, node: state.node });

    feedback(
      stale.length
        ? `Caché de ${id} limpiada. Reinicia: ${stale.join(', ')}.`
        : `Caché de ${id} limpiada.`,
      'success',
    );
  } catch (error) {
    feedback(error.message, 'error', error.details);
  } finally {
    pollStatus();
  }
};

const launchApps = async (selection, button) => {
  if (!selection.length) {
    feedback('Selecciona al menos un microfrontend', 'error');
    return;
  }

  if (button) {
    button.disabled = true;
  }
  feedback(`Levantando ${selection.map((app) => app.id).join(', ')}…`);

  try {
    const { results } = await api('/api/start', {
      env: state.env,
      mode: state.mode,
      terminalApp: state.terminalApp,
      node: state.node,
      apps: selection.map((app) => app.id),
      remotes: resolvedRemotes(),
    });
    const failed = results.filter((result) => !result.ok);
    const started = results.filter((result) => result.ok);

    if (failed.length) {
      feedback(
        started.length ? 'Algunos micros no se levantaron' : 'No se levantó ningún micro',
        'error',
        failed.map((result) => result.error),
      );
    } else {
      feedback(`Levantados en ${state.env.toUpperCase()}: ${started.map((r) => r.id).join(', ')}`, 'success');
    }

    if (started.length && !started.some((result) => result.id === state.activeTab)) {
      selectTab(started[0].id);
    }
  } catch (error) {
    feedback(error.message, 'error', error.details);
  } finally {
    if (button) {
      button.disabled = false;
    }
    pollStatus();
  }
};

export const startSelected = () => launchApps(selectedApps(), $('start-selected'));

const startOne = (app) => launchApps([app], cards[app.id].start);

const openConsole = (app) => {
  selectTab(app.id);
  state.activeView = 'console';
  persist();
  updateActiveView();
};

export const renderCards = () => {
  $('cards').replaceChildren(
    ...apps().map((app) => {
      const checkbox = el('input', { type: 'checkbox' });
      const badge = el('span', { className: 'badge' });
      const branch = el('p', { className: 'card-branch' });
      const meta = el('p', { className: 'card-meta' });
      const reason = el('p', { className: 'card-reason' });
      const start = el('button', {
        type: 'button',
        className: 'card-start',
        title: 'Iniciar este micro',
        onClick: () => startOne(app),
      }, [el('span', { 'aria-hidden': 'true', text: '▶' }), el('span', { text: 'Iniciar' })]);
      const stop = el('button', {
        type: 'button',
        className: 'card-stop',
        title: 'Detener este micro',
        text: 'Detener',
        onClick: () => runAction('stop', app.id),
      });
      const restart = el('button', {
        type: 'button',
        className: 'card-restart',
        title: 'Reiniciar este micro',
        text: 'Reiniciar',
        onClick: () => runAction('restart', app.id),
      });
      const logs = el('button', {
        type: 'button',
        className: 'card-console',
        title: 'Ver la consola de este micro',
        onClick: () => openConsole(app),
      }, [el('span', { 'aria-hidden': 'true', text: '›_' }), el('span', { text: 'Consola' })]);
      const open = el('a', {
        className: 'button card-open',
        href: `http://localhost:${app.port}`,
        target: '_blank',
        rel: 'noopener',
        title: `Abrir http://localhost:${app.port}`,
        text: 'Abrir ↗',
      });
      const clean = el('button', {
        type: 'button',
        className: 'card-clean',
        title: 'Borra .next, la carpeta de build y limpia la caché de yarn',
        onClick: () => cleanCache(app.id),
      });
      const cleanIcon = el('span', { 'aria-hidden': 'true', text: '▤' });
      const cleanLabel = el('span', { text: 'Limpiar caché' });
      clean.append(cleanIcon, cleanLabel);
      const environment = el('button', {
        type: 'button',
        className: 'card-environment',
        'data-environment-app': app.id,
        title: 'Ver y editar los archivos .env.stg, .env.uat y .env.prod',
        text: 'Variables de entorno',
        onClick: () => openEnvironmentEditor(app),
      });
      const stale = el('p', { className: 'card-stale' });
      const details = CARD_DETAILS[app.id] || {
        icon: '▣',
      };
      const more = el('details', { className: 'card-more' }, [
        el('summary', { title: `Más acciones para ${app.label}`, 'aria-label': `Más acciones para ${app.label}`, text: '⋮' }),
        el('div', { className: 'card-more-menu' }, [environment]),
      ]);

      more.addEventListener('toggle', () => {
        if (more.open) {
          closeCardMenus(more);
        }
        root.classList.toggle('is-menu-open', more.open);
      });
      more.addEventListener('focusout', () => {
        window.setTimeout(() => {
          if (!more.contains(document.activeElement)) {
            more.open = false;
          }
        });
      });
      more.addEventListener('click', (event) => {
        if (event.target.closest('.card-more-menu')) {
          more.open = false;
        }
      });

      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selected.add(app.id);
        } else {
          state.selected.delete(app.id);
        }
        persist();
        updateAll();
      });

      const root = el('article', { className: 'card' }, [
        el('div', { className: 'card-head' }, [
          el('label', { className: 'card-select' }, [
            checkbox,
            el('span', { className: 'card-icon', 'aria-hidden': 'true', text: details.icon }),
            el('span', { className: 'card-title', text: app.label }),
            el('span', { className: 'card-port', text: `:${app.port}` }),
          ]),
          el('div', { className: 'card-head-actions' }, [badge, more]),
        ]),
        branch,
        meta,
        reason,
        el('div', { className: 'card-action-rows' }, [
          el('div', { className: 'card-actions card-actions-primary' }, [start, restart, stop]),
          el('div', { className: 'card-actions card-actions-secondary' }, [open, logs, clean]),
        ]),
        el('div', { className: 'card-footer' }, [stale]),
      ]);

      cards[app.id] = {
        root,
        checkbox,
        badge,
        branch,
        meta,
        reason,
        start,
        stop,
        restart,
        open,
        environment,
        clean,
        more,
        stale,
      };
      return root;
    }),
  );
};

const describeRun = (status) => {
  const mode = status.mode || state.mode;
  const environment = status.env || state.env;
  const selectedNode = state.config.nodeVersions.find((node) => node.id === state.node);
  const nodeVersion = status.node || selectedNode?.version;
  const where = mode === 'terminal' ? 'Terminal nativa' : 'Web';
  const node = nodeVersion ? ` · Node ${nodeVersion}` : '';
  const pid = status.pid ? ` · pid ${status.pid}` : '';

  return `${where} · ${String(environment).toUpperCase()}${node}${pid}`;
};

export const updateCard = (app) => {
  const card = cards[app.id];
  const status = statusOf(app.id);
  const reasons = reasonsFor(app);
  const valid = reasons.length === 0;
  const selected = valid && state.selected.has(app.id);
  const reachable = ['ready', 'port-busy'].includes(status.status);

  card.checkbox.disabled = !valid;
  card.checkbox.checked = selected;
  card.root.classList.toggle('is-selected', selected);
  card.root.classList.toggle('is-disabled', !valid);

  card.badge.className = `badge status-${status.status}`;
  card.badge.textContent = STATUS_LABELS[status.status] || status.status;
  card.branch.textContent = app.branch || '';
  card.branch.title = app.branch ? `Rama actual: ${app.branch}` : '';
  card.meta.textContent = describeRun(status);
  card.reason.textContent = valid ? status.message || '' : reasons.join(' · ');
  card.reason.classList.toggle('is-warning', !valid || status.status === 'error');

  card.start.disabled = !valid || isRunning(app.id) || Boolean(status.cleaning);
  card.stop.disabled = !isRunning(app.id);
  card.restart.disabled = !status.canRestart;
  card.open.classList.toggle('is-disabled', !reachable);

  card.clean.disabled = Boolean(status.cleaning);
  card.clean.lastElementChild.textContent = status.cleaning
    ? 'Limpiando caché…'
    : 'Limpiar caché';

  card.stale.hidden = !status.staleAfterClean;
  card.stale.textContent = status.staleAfterClean
    ? '⚠ Caché limpiada · reinicia para aplicar los cambios'
    : '';
  card.root.classList.toggle('is-stale', Boolean(status.staleAfterClean));
};
