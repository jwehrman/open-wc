const fs = require('fs');
const util = require('util');
const portfinder = require('portfinder');
const chokidar = require('chokidar');
const fetch = require('node-fetch');
const { startServer, createConfig } = require('es-dev-server');

const regexpKarmaLoaded = /window\.__karma__\.loaded\(\);/gm;
const regexpScriptSrcGlobal = /<script type="module"[^>]*src="([^"]*)"/gm;
const regexpScriptSrc = /<script type="module"[^>]*src="([^"]*)"/m;

const readFileAsync = util.promisify(fs.readFile);

/**
 * Load importMap content from a filepath
 * @param {string} path
 * @returns {Promise<string>}
 */
async function loadImportMap(path) {
  let result;
  try {
    result = await readFileAsync(path, 'utf8');
  } catch (error) {
    console.warn(`Unable to load importMap from "${path}": ${error}`); // eslint-disable-line no-console
  }
  return result;
}

/**
 * Fetches the original test HTML file from karma and injects code to ensure all tests
 * are loaded before running karma.
 * @param {string} karmaHost
 * @param {string} name
 * @param {string} importMap
 * @returns {Promise<{ body: string}>}
 */
async function fetchKarmaHTML(karmaHost, name, importMap) {
  // fetch the original html source from karma, so that it injects test files
  // @ts-ignore
  const response = await fetch(`${karmaHost}/${name}.html?bypass-es-dev-server`);
  let body = await response.text();

  if (importMap) {
    body = body.replace(
      '</head>',
      `<script type="importmap">
      ${importMap}
    </script>
    </head>`,
    );
  }

  // extract all test file sources
  const matches = body.match(regexpScriptSrcGlobal);
  if (matches) {
    const srcPaths = matches
      .map(match => match.match(regexpScriptSrc)[1])
      .filter(path => typeof path === 'string');

    // disable default karma loaded call
    body = body.replace(
      regexpKarmaLoaded,
      '// disabled by karma-esm\n // window.__karma__.loaded();',
    );

    // inject module which imports all test files, and then calls karma loaded.
    // this ensures that when running in compatibility mode all tests are properly
    // imported before starting karma
    body = body.replace(
      '</body>',
      `<script type="module">
      // generated by karma-esm to ensure all tests are loaded before running karma
      // in compatibility mode
      Promise.all([${srcPaths
        .map(
          path => `import('${path}')
          .catch((e) => {
            console.log('Error loading test file: ${path.split('?')[0].replace('/base', '')}');
            throw e;
          })`,
        )
        .join(',')}])
        .then(() => window.__karma__.loaded())
        .catch(() => window.__karma__.error())
    </script>
    </body>`,
    );
  }

  return { body };
}

/**
 * Serves karma test HTML from es-dev-server. The actual HTML is requested from karma itself,
 * so that karma can inject test files and libraries. Then it goes through the regular
 * es-dev-server serving logic, so that modules are resolved and babel or compatibility mode
 * can process the html and test files.
 */
function createServeKarmaHtml(karmaHost, importMap) {
  return async function serveKarmaHtml({ url }) {
    if (url.startsWith('/context.html')) {
      return fetchKarmaHTML(karmaHost, 'context', importMap);
    }

    if (url.startsWith('/debug.html')) {
      return fetchKarmaHTML(karmaHost, 'debug', importMap);
    }

    return null;
  };
}

async function setupDevServer(karmaConfig, esmConfig, watch, babelConfig, karmaEmitter) {
  const devServerPort =
    typeof esmConfig.port === 'number' ? esmConfig.port : await portfinder.getPortPromise();
  const karmaHost = `${karmaConfig.protocol}//${karmaConfig.hostname}:${karmaConfig.port}`;
  const devServerHost = `${karmaConfig.protocol}//${karmaConfig.hostname}:${devServerPort}`;
  const importMap = esmConfig.importMap ? await loadImportMap(esmConfig.importMap) : null;

  const esDevServerConfig = createConfig({
    port: devServerPort,
    hostname: karmaConfig.hostname,
    rootDir: karmaConfig.basePath,
    nodeResolve: esmConfig.nodeResolve,
    polyfillsLoader: esmConfig.polyfillsLoader,
    dedupe: esmConfig.dedupe,
    compatibility: esmConfig.compatibility,
    // option used to be called `moduleDirectories`
    // @ts-ignore
    moduleDirs: esmConfig.moduleDirs || esmConfig.moduleDirectories,
    babel: esmConfig.babel,
    fileExtensions: esmConfig.fileExtensions,
    babelModernExclude: esmConfig.babelModernExclude,
    babelExclude: esmConfig.babelExclude,
    babelModuleExclude: esmConfig.babelModuleExclude,
    // option used to be called `customMiddlewares`
    // @ts-ignore
    middlewares: esmConfig.middlewares || esmConfig.customMiddlewares,
    preserveSymlinks: esmConfig.preserveSymlinks,
    responseTransformers: [
      createServeKarmaHtml(karmaHost, importMap),
      ...(esmConfig.responseTransformers || []),
    ],
    debug: esmConfig.debug,
    watch: false,
    babelConfig,
  });

  let fileWatcher = chokidar.watch([]);
  let { server } = await startServer(esDevServerConfig, fileWatcher);

  if (watch) {
    fileWatcher.addListener('change', () => {
      karmaEmitter.refreshFiles();
    });
  }

  ['exit', 'SIGINT'].forEach(event => {
    // @ts-ignore
    process.on(event, () => {
      if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
      }

      if (server) {
        server.close();
        server = null;
      }
    });
  });

  return devServerHost;
}

module.exports = setupDevServer;
