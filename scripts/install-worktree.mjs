// Install engine/ and window/ dependencies in a fresh worktree the way CI does: frozen lockfile, no install
// scripts, and the verified release-age exceptions from feature-batch-ci-runtime.mjs. Packages are hardlinked
// from the local pnpm store, so a worktree costs seconds and almost no disk.
// Usage: node scripts/install-worktree.mjs [engine|window|both]   (run from the worktree root)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedExceptionFlags } from './feature-batch-ci-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The pnpm arguments for one lane, given its verified exception flags. */
export function installArgs(flags) {
  return ['install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline',
    '--package-import-method=hardlink', ...flags];
}

export function lanesFor(which) {
  if (which === 'both') return ['engine', 'window'];
  if (which === 'engine' || which === 'window') return [which];
  throw new Error('usage: node scripts/install-worktree.mjs [engine|window|both]');
}

async function main(which = 'both') {
  for (const lane of lanesFor(which)) {
    const args = installArgs(await verifiedExceptionFlags(lane));
    // pnpm is a .cmd shim on Windows, which Node only starts through a shell; the flags hold no shell syntax.
    const result = spawnSync('pnpm', args, { cwd: path.join(root, lane), stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
      console.error(`${lane}: pnpm install exited ${result.status}`);
      process.exit(result.status ?? 1);
    }
    console.log(`${lane}: installed`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
