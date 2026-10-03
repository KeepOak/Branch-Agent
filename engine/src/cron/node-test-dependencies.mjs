import Module, { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const dependencyRoot = process.env.BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT;
if (!dependencyRoot) throw new Error('BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT is required');
const dependencyParent = pathToFileURL(`${dependencyRoot}/package.json`).href;
const sourceRoot = new URL('../../', import.meta.url).href;
const dependencyUrl = pathToFileURL(`${dependencyRoot}/`).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  // Source workers deliberately choose their own execArgv. Bootstrap the same
  // read-only dependency resolver in those real threads, never replace a worker.
  if (specifier === 'tsx/esm' && process.env.BRANCH_AUTOMATION_WORKER_PRELOAD && context.parentURL?.includes('/src/infra/runtime-worker-url.')) {
    return { url: process.env.BRANCH_AUTOMATION_WORKER_PRELOAD, shortCircuit: true };
  }
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code) || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) throw error;
    const parentURL = context.parentURL?.startsWith(sourceRoot)
      ? dependencyUrl + context.parentURL.slice(sourceRoot.length) : dependencyParent;
    try { return nextResolve(specifier, { ...context, parentURL }); }
    catch { return nextResolve(specifier, { ...context, parentURL: dependencyParent }); }
  }
}});

// Jiti and tsx can resolve native require() edges through the CommonJS resolver.
// Keep those real package edges in the same read-only dependency checkout.
const resolveFilename = Module._resolveFilename;
const sourcePath = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
Module._resolveFilename = function(specifier, parent, ...options) {
  try { return resolveFilename.call(this, specifier, parent, ...options); }
  catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code) || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) throw error;
    const originalParent = parent?.filename?.replaceAll('\\', '/');
    const mirroredParent = originalParent?.startsWith(sourcePath)
      ? dependencyRoot + '/' + originalParent.slice(sourcePath.length) : dependencyRoot + '/package.json';
    return createRequire(mirroredParent).resolve(specifier);
  }
};