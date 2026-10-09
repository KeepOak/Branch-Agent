// Metro config: Expo defaults plus the engine's gateway client compiled from source (engine-modules.js).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { packagesRoot, resolveEngineModule } = require('./engine-modules');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), packagesRoot];
// Babel helpers injected into compiled engine files resolve from this app's node_modules.
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = resolveEngineModule(moduleName, context.originModulePath);
  if (filePath) return { type: 'sourceFile', filePath };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
