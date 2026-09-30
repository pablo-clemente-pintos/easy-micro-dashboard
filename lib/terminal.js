const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TERMINALS = [
  {
    id: 'terminal',
    label: 'Terminal',
    bundles: [
      '/System/Applications/Utilities/Terminal.app',
      '/Applications/Utilities/Terminal.app',
    ],
  },
  {
    id: 'iterm',
    label: 'iTerm',
    bundles: [
      '/Applications/iTerm.app',
      path.join(os.homedir(), 'Applications', 'iTerm.app'),
    ],
  },
];

const TERMINAL_APPS = TERMINALS.map((terminal) => terminal.id);

// Same AppleScript used by scripts/run-microfrontends.zsh.
const SCRIPTS = {
  terminal: `on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run`,
  iterm: `on run argv
  tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
      write text (item 1 of argv)
    end tell
  end tell
end run`,
};

const isInstalled = (terminal) =>
  terminal.bundles.some((bundle) => fs.existsSync(bundle));

// AppleScript compiles against the app dictionary, so a missing app surfaces
// as a cryptic syntax error (-2741). Checked up front on every request.
const listTerminals = () =>
  TERMINALS.map(({ id, label, ...terminal }) => ({
    id,
    label,
    installed: isInstalled(terminal),
  }));

const isTerminalAvailable = (id) =>
  listTerminals().some((terminal) => terminal.id === id && terminal.installed);

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const openTerminal = (terminalApp, command) =>
  new Promise((resolve, reject) => {
    const terminal = TERMINALS.find((item) => item.id === terminalApp);

    if (!terminal) {
      reject(new Error(`Terminal no soportada: ${terminalApp}`));
      return;
    }

    if (!isInstalled(terminal)) {
      reject(new Error(`${terminal.label} no está instalado en esta Mac`));
      return;
    }

    const child = execFile(
      'osascript',
      ['-', command],
      (error, _stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`No se pudo abrir ${terminal.label}: ${detail}`));
          return;
        }
        resolve();
      },
    );

    child.stdin.end(SCRIPTS[terminalApp]);
  });

module.exports = {
  TERMINAL_APPS,
  isTerminalAvailable,
  listTerminals,
  openTerminal,
  shellQuote,
};
