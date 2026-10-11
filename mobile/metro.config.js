// Metro config: Expo defaults plus the engine's gateway client compiled from source (engine-modules.js).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { engineCyclePattern, packagesRoot, resolveEngineModule } = require('./engine-modules');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), packagesRoot];
// Babel helpers injected into compiled engine files resolve from this app's node_modules.
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
// The engine's packages are a dependency like node_modules, which Metro already leaves out of its
// "Require cycle" warning. Their one cycle (gateway-client's session-projection.ts re-exports
// session-projection-run-event.ts, which imports it back) only touches functions at call time, so it is
// safe; the engine owns it. A cycle in the app's own files still warns.
config.resolver.requireCycleIgnorePatterns = [...(config.resolver.requireCycleIgnorePatterns ?? []), engineCyclePattern];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = resolveEngineModule(moduleName, context.originModulePath);
  if (filePath) return { type: 'sourceFile', filePath };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
