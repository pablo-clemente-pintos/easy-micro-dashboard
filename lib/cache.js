const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { appDir } = require('./apps');

// `yarn cache clean` normally takes a few seconds; if it hangs (locked cache,
// stalled registry) we kill it so the UI never gets stuck in "Limpiando…".
const CLEAN_TIMEOUT_MS = 60000;

// Per-app version of clean-home-host.sh: remove .next and the custom distDir,
// then `yarn cache clean` (which, as in the script, is global to the machine).
const cacheTargets = (app) => ['.next', app.buildDir].filter(Boolean);

const removeTarget = async (dir, target) => {
  const full = path.resolve(dir, target);

  // Never delete anything outside the app folder.
  if (full !== dir && !full.startsWith(`${dir}${path.sep}`)) {
    throw new Error(`Ruta fuera de la app: ${target}`);
  }

  await fs.promises.rm(full, { recursive: true, force: true });
};

const yarnCacheClean = (dir, env, onOutput) =>
  new Promise((resolve, reject) => {
    const child = spawn('yarn', ['cache', 'clean'], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      // Settle first so the kill's 'close' event can't overwrite the message.
      finish(
        reject,
        new Error(`yarn cache clean superó ${CLEAN_TIMEOUT_MS / 1000}s y se detuvo`),
      );
      child.kill('SIGKILL');
    }, CLEAN_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => onOutput(chunk.toString('utf8')));
    child.stderr.on('data', (chunk) => onOutput(chunk.toString('utf8')));
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) =>
      code === 0
        ? finish(resolve)
        : finish(reject, new Error(`yarn cache clean terminó con código ${code}`)),
    );
  });

// Mirrors the body of clean-home-host.sh for a single app.
const cleanCache = async (app, { env, onStep, onOutput }) => {
  const dir = appDir(app);

  for (const target of cacheTargets(app)) {
    onStep(`rm -rf ${target}`);
    await removeTarget(dir, target);
  }

  onStep('yarn cache clean');
  await yarnCacheClean(dir, env, onOutput);
};

module.exports = { cacheTargets, cleanCache };
