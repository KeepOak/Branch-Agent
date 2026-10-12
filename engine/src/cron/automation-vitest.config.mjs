import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const dependencyRoot = process.env.BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT;
if (!dependencyRoot) throw new Error('BRANCH_AUTOMATION_TEST_DEPENDENCY_ROOT is required');
process.env.BRANCH_AUTOMATION_WORKER_PRELOAD = new URL('./node-test-worker-preload.mjs', import.meta.url).href;

const paths = JSON.parse(fs.readFileSync(`${root}/tsconfig.json`, 'utf8')).compilerOptions.paths;
function resolveSource(id) {
  for (const [pattern, targets] of Object.entries(paths)) {
    const wildcard = pattern.indexOf('*');
    if (wildcard < 0 && id === pattern) return path.resolve(root, targets[0]);
    if (wildcard >= 0 && id.startsWith(pattern.slice(0, wildcard)) && id.endsWith(pattern.slice(wildcard + 1))) {
      const tail = id.slice(wildcard, id.length - (pattern.length - wildcard - 1));
      return path.resolve(root, targets[0].replace('*', tail));
    }
  }
}
export default {
  root,
  cacheDir: process.env.BRANCH_AUTOMATION_TEST_CACHE_DIR ?? `${root}/.cache/automation-vitest`,
  plugins: [{ name: 'automation-read-only-dependencies', enforce: 'pre', resolveId(id, importer) {
    const source = resolveSource(id);
    if (source) return source;
    if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('node:') && !id.startsWith('file:') && !/^[A-Za-z]:/.test(id)) {
      try { return fileURLToPath(import.meta.resolve(id)); }
      catch (error) {
        if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
        // Try the mirrored importer next for ordinary package resolution misses.
      }
      if (importer?.startsWith(root)) {
        try { return createRequire(importer.replace(root, dependencyRoot)).resolve(id); }
        catch (error) {
          if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
          // The Vite resolver owns the final missing-package diagnostic.
          return undefined;
        }
      }
    }
  }}],
  test: {
    pool: 'forks', maxWorkers: 1, fileParallelism: false, isolate: true,
    testTimeout: 60000, hookTimeout: 120000,
    setupFiles: [`${root}/test/setup.ts`],
    include: ['src/**/*.test.ts'],
    execArgv: ['--max-old-space-size=384', '--import', `file:///${dependencyRoot}/node_modules/tsx/dist/esm/index.mjs`, '--import', `file:///${root}/src/cron/node-test-dependencies.mjs`],
  },
};
