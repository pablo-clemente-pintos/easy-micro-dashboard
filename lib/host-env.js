const fs = require('fs');
const path = require('path');

const { appDir, getApps, getHostApp } = require('./apps');

const unquote = (value) => {
  const trimmed = value.trim();
  const quote = trimmed[0];

  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, '');
};

/**
 * Reads host/.env.<env> and returns ONLY the remote URIs used by
 * host/next.config.js. Any other key (tokens, secrets...) is ignored.
 */
const readHostRemoteUris = (env) => {
  const remoteKeys = getApps()
    .filter((app) => app.remoteKey)
    .map((app) => app.remoteKey);
  const host = getHostApp();
  const result = Object.fromEntries(remoteKeys.map((key) => [key, null]));

  if (!host) {
    return result;
  }

  let content;

  try {
    content = fs.readFileSync(path.join(appDir(host), `.env.${env}`), 'utf8');
  } catch {
    return result;
  }

  content.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/);

    if (match && remoteKeys.includes(match[1])) {
      result[match[1]] = unquote(match[2]);
    }
  });

  return result;
};

module.exports = { readHostRemoteUris };
