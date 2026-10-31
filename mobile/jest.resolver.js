// Jest resolver: the same engine source mapping Metro uses (engine-modules.js). Compiled engine files
// also import Babel helpers; those resolve from this app's node_modules, as Metro's nodeModulesPaths does.
// Window stage files (touch-gestures.ts, remote-map.ts) compile the same way. Non-relative requests from
// them use this app's node_modules so Babel helpers resolve; relative imports stay in window/src/stage.
const path = require('node:path');
const { packagesRoot, resolveEngineModule } = require('./engine-modules');

const windowStage = path.resolve(__dirname, '..', 'window', 'src', 'stage');

module.exports = (request, options) => {
  const origin = options.basedir ? path.join(options.basedir, '_') : undefined;
  const mapped = resolveEngineModule(request, origin);
  if (mapped) return mapped;
  const basedir = options.basedir ? path.resolve(options.basedir) : undefined;
  const fromEngine = basedir && basedir.startsWith(packagesRoot + path.sep);
  const fromWindowStage = basedir && (basedir === windowStage || basedir.startsWith(windowStage + path.sep));
  const rewriteBasedir = fromEngine || (fromWindowStage && !request.startsWith('.'));
  return options.defaultResolver(request, rewriteBasedir ? { ...options, basedir: __dirname } : options);
};
