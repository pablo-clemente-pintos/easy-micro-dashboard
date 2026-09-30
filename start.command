#!/bin/zsh
# Double-click in Finder (or run ./start.command) to open the launcher.

cd "${0:A:h}" || exit 1

if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi

if ! command -v node >/dev/null 2>&1; then
  print -u2 'No se encontró node en el PATH.'
  exit 1
fi

exec node server.js --open
