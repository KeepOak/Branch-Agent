// Read actual lane TypeScript for native tests; never replace behavior with mocks.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks, createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Optional read-only reuse of an existing install for isolated worktree tests.
// Resolve before registering hooks to avoid recursive require.resolve calls.
const dependencyRoot = process.env.BRANCH_MEMORY_SKILLS_DEPENDENCY_ROOT;
const fsSafePath = dependencyRoot
  ? pathToFileURL(createRequire(path.join(dependencyRoot, 'package.json')).resolve('@openclaw/fs-safe/path')).href
  : undefined;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openclaw/fs-safe/path' && fsSafePath) return {url:fsSafePath,shortCircuit:true};
    let source;
    if (specifier.startsWith('branch/plugin-sdk/')) {
      source = path.join(engineRoot, 'src/plugin-sdk', specifier.slice('branch/plugin-sdk/'.length) + '.ts');
    } else if (specifier === '@branch/normalization-core' || specifier.startsWith('@branch/normalization-core/')) {
      const suffix = specifier === '@branch/normalization-core' ? 'index' : specifier.slice('@branch/normalization-core/'.length);
      source = path.join(engineRoot, 'packages/normalization-core/src', suffix + '.ts');
    }
    if (source) return { url: pathToFileURL(source).href, shortCircuit: true };
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && context.parentURL?.startsWith('file:') && specifier.startsWith('.') && specifier.endsWith('.js')) {
        const candidate = fileURLToPath(new URL(specifier.slice(0, -3) + '.ts', context.parentURL));
        const relative = path.relative(engineRoot, candidate);
        if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
      throw error;
    }
  },
});
