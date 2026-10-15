// Builds the command that starts the window's Vite dev server for the crawl.
// `pnpm exec vite` fails when window/node_modules is a symlink (git worktrees), so the crawl runs
// vite's own bin with node. pnpm is the fallback only when that bin cannot be resolved.
import { dirname, resolve } from 'node:path';

export function viteLaunch(args, resolver) {
  try {
    const viteRoot = dirname(resolver.resolve('vite/package.json'));
    return { command: process.execPath, args: [resolve(viteRoot, 'bin/vite.js'), ...args] };
  } catch {
    return { command: 'pnpm', args: ['exec', 'vite', ...args] };
  }
}
