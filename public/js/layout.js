// Sidebar collapse/open behaviour and the services/remotes/console view switch.

import { $, state, persist } from './core.js';

export const updateActiveView = () => {
  document.body.classList.toggle('is-console-view', state.activeView === 'console');

  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== state.activeView;
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
};

export const setupViews = () => {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeView = button.dataset.view;
      persist();
      updateActiveView();
    });
  });

  updateActiveView();
};

export const setupSidebar = () => {
  const shell = $('app-shell');
  const desktopToggle = $('sidebar-toggle');
  const mobileToggle = $('sidebar-mobile-toggle');
  const mobileClose = $('sidebar-mobile-close');
  const pageShell = document.querySelector('.page-shell');
  const mobileViewport = window.matchMedia('(max-width: 920px)');
  const closeMobileSidebar = () => shell.classList.remove('is-sidebar-open');

  const update = () => {
    shell.classList.toggle('is-sidebar-collapsed', state.sidebarCollapsed);
    desktopToggle.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    desktopToggle.setAttribute(
      'aria-label',
      state.sidebarCollapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral',
    );
  };

  desktopToggle.addEventListener('click', () => {
    if (mobileViewport.matches) {
      closeMobileSidebar();
      return;
    }

    state.sidebarCollapsed = !state.sidebarCollapsed;
    persist();
    update();
  });

  mobileToggle.addEventListener('click', () => {
    shell.classList.toggle('is-sidebar-open');
  });
  mobileClose.addEventListener('click', closeMobileSidebar);
  pageShell.addEventListener('click', (event) => {
    if (mobileViewport.matches && !event.target.closest('#sidebar-mobile-toggle')) {
      closeMobileSidebar();
    }
  });

  document.querySelectorAll('.sidebar-nav a, .sidebar-nav button').forEach((link) => {
    link.addEventListener('click', () => {
      if (mobileViewport.matches) {
        closeMobileSidebar();
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMobileSidebar();
    }
  });

  update();
};
