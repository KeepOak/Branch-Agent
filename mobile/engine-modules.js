// The phone speaks the same gateway protocol as the desktop window by using the engine's own client
// source (engine/packages/gateway-client, gateway-protocol and their two helper packages) instead of a
// second copy. Those packages have no third-party runtime dependencies, so Metro and Jest compile them
// straight from source. Only these packages are mapped; everything else resolves normally.
const fs = require('node:fs');
const path = require('node:path');

const packagesRoot = path.resolve(__dirname, '..', 'engine', 'packages');

const packages = {
  '@branch/gateway-client': 'gateway-client',
  '@branch/gateway-protocol': 'gateway-protocol',
  '@branch/normalization-core': 'normalization-core',
  '@branch/retry': 'retry',
};

function existing(base) {
  for (const candidate of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Absolute source file for an engine package import, or null when the import is not one of ours. */
function resolveEngineModule(moduleName, originPath) {
  const bare = /^(@branch\/[a-z-]+)(?:\/(.+))?$/.exec(moduleName);
  if (bare && packages[bare[1]]) {
    const src = path.join(packagesRoot, packages[bare[1]], 'src');
    const found = existing(path.join(src, bare[2] ?? 'index'));
    if (!found) throw new Error(`Engine module ${moduleName} has no source file under ${path.relative(__dirname, src)}`);
    return found;
  }
  // Engine sources import siblings as "./name.js" (NodeNext style); the file on disk is name.ts.
  if (originPath && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const origin = path.resolve(originPath);
    if (origin.startsWith(packagesRoot + path.sep)) {
      return existing(path.resolve(path.dirname(origin), moduleName.slice(0, -3)));
    }
  }
  return null;
}

/** Matches a module under engine/packages as Metro names it in a require-cycle warning ("../engine/packages/…"). */
const engineCyclePattern = /(^|[\\/])engine[\\/]packages[\\/]/;

module.exports = { engineCyclePattern, packagesRoot, resolveEngineModule };
