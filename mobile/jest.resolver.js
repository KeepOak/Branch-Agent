// Jest resolver: the same engine source mapping Metro uses (engine-modules.js). Compiled engine files
// also import Babel helpers; those resolve from this app's node_modules, as Metro's nodeModulesPaths does.
const path = require('node:path');
const { packagesRoot, resolveEngineModule } = require('./engine-modules');

module.exports = (request, options) => {
  const origin = options.basedir ? path.join(options.basedir, '_') : undefined;
  const mapped = resolveEngineModule(request, origin);
  if (mapped) return mapped;
  const fromEngine = options.basedir && path.resolve(options.basedir).startsWith(packagesRoot + path.sep);
  return options.defaultResolver(request, fromEngine ? { ...options, basedir: __dirname } : options);
};
