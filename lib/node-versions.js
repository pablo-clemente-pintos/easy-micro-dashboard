const fs = require('fs');
const os = require('os');
const path = require('path');

const NVM_DIR = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
const CURRENT = 'current';

// @module-federation/manifest calls util.styleText, added in Node 20.12.
const MIN_RECOMMENDED = [20, 12, 0];

const parse = (version) => version.replace(/^v/, '').split('.').map(Number);

const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) {
      return x[i] - y[i];
    }
  }
  return 0;
};

const isRecommended = (version) =>
  compare(version, `v${MIN_RECOMMENDED.join('.')}`) >= 0;

const listNvmVersions = () => {
  const root = path.join(NVM_DIR, 'versions', 'node');

  try {
    return fs
      .readdirSync(root)
      .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
      .filter((name) => fs.existsSync(path.join(root, name, 'bin', 'node')))
      .sort((a, b) => compare(b, a))
      .map((version) => ({ id: version, version, bin: path.join(root, version, 'bin') }));
  } catch {
    return [];
  }
};

const listNodeVersions = () => [
  {
    id: CURRENT,
    version: process.version,
    bin: path.dirname(process.execPath),
  },
  ...listNvmVersions(),
];

// LAUNCHER_NODE wins; otherwise the newest Node 20 (what production runs)
// that is new enough, then any new enough version, then the launcher's own.
const defaultNodeId = (versions) => {
  const requested = process.env.LAUNCHER_NODE;
  const nvm = versions.filter((item) => item.id !== CURRENT);

  if (requested) {
    const wanted = requested.startsWith('v') ? requested : `v${requested}`;
    const match = nvm.find((item) => item.version === wanted || item.version.startsWith(`${wanted}.`));
    if (match) {
      return match.id;
    }
  }

  if (isRecommended(process.version) && parse(process.version)[0] === 20) {
    return CURRENT;
  }

  const node20 = nvm.find((item) => parse(item.version)[0] === 20 && isRecommended(item.version));
  const anyRecommended = nvm.find((item) => isRecommended(item.version));

  return (node20 || anyRecommended || { id: CURRENT }).id;
};

module.exports = { defaultNodeId, isRecommended, listNodeVersions };
