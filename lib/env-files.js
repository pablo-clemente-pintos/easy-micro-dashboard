const fs = require('fs');
const path = require('path');

const { ENVIRONMENTS, appDir } = require('./apps');

const MAX_ENV_FILE_BYTES = 160 * 1024;

const environmentPath = (app, env) => path.join(appDir(app), `.env.${env}`);

const assertAppDirectory = (app) => {
  const directory = appDir(app);

  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`No existe la carpeta ${app.directory}`);
  }

  return directory;
};

const readEnvironmentFiles = (app) => {
  assertAppDirectory(app);

  return Object.fromEntries(
    ENVIRONMENTS.map((env) => {
      const file = environmentPath(app, env);

      try {
        return [env, { exists: true, content: fs.readFileSync(file, 'utf8') }];
      } catch (error) {
        if (error.code === 'ENOENT') {
          return [env, { exists: false, content: '' }];
        }
        throw error;
      }
    }),
  );
};

const validateFiles = (files) => {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Indica el contenido de los archivos de ambiente');
  }

  return Object.fromEntries(
    ENVIRONMENTS.map((env) => {
      const content = files[env];

      if (typeof content !== 'string') {
        throw new Error(`El contenido de .env.${env} debe ser texto`);
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_ENV_FILE_BYTES) {
        throw new Error(`.env.${env} supera el tamaño máximo permitido`);
      }
      if (content.includes('\0')) {
        throw new Error(`.env.${env} contiene caracteres no permitidos`);
      }

      return [env, content];
    }),
  );
};

const writeEnvironmentFiles = (app, files) => {
  const directory = assertAppDirectory(app);
  const contents = validateFiles(files);
  const temporaryFiles = [];

  try {
    ENVIRONMENTS.forEach((env) => {
      const target = environmentPath(app, env);
      const temporary = path.join(
        directory,
        `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
      );

      fs.writeFileSync(temporary, contents[env], 'utf8');
      temporaryFiles.push({ target, temporary });
    });

    temporaryFiles.forEach(({ target, temporary }) => fs.renameSync(temporary, target));
  } finally {
    temporaryFiles.forEach(({ temporary }) => {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    });
  }

  return readEnvironmentFiles(app);
};

module.exports = { readEnvironmentFiles, writeEnvironmentFiles };
