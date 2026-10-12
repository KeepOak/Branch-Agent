// Dead-code gate for window/: Knip with window/knip.jsonc, failing on unused files, exports, types,
// duplicate exports and dependencies. Prior art: engine/package.json "deadcode:knip", which runs the same
// pinned Knip through pnpm dlx.
//
//   node scripts/window-deadcode.mjs        uses the window's installed node_modules (local runs)
//   node scripts/window-deadcode.mjs --ci   first installs the window's frozen toolchain the way the
//                                           feature batch does (verified pnpm, frozen lock, no scripts)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertLocalModules, preparePnpm, publishWindowDependencies, run, scratchRoot, toolingRoot,
  verifiedExceptionFlags, windowRoot,
} from './feature-batch-ci-runtime.mjs';

export const KNIP = 'knip@6.32.2';
export const knipArgs = ['dlx', '--package', KNIP, 'knip', '--no-progress', '--no-config-hints'];

async function installWindow(pnpm) {
  const flags = await verifiedExceptionFlags('window');
  await run(pnpm, ['install', '--frozen-lockfile', '--ignore-scripts', ...flags,
    `--modules-dir=${path.join(windowRoot, 'node_modules')}`,
    `--virtual-store-dir=${path.join(windowRoot, 'node_modules/.pnpm')}`], toolingRoot);
  await publishWindowDependencies();
  await assertLocalModules(windowRoot, ['vite', '@vitejs/plugin-react', 'vitest', 'react']);
}

export async function main(argv = process.argv.slice(2)) {
  await fs.access(path.join(windowRoot, 'knip.jsonc'));
  if (!argv.includes('--ci')) {
    // Local runs use the pnpm on PATH; the shell resolves pnpm.cmd on Windows.
    const result = spawnSync('pnpm', knipArgs, { cwd: windowRoot, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
    if (result.status !== 0) throw new Error(`knip exited ${result.status ?? result.signal}`);
    return;
  }
  const scratch = await scratchRoot();
  try {
    const pnpm = await preparePnpm(scratch);
    await installWindow(pnpm);
    await run(pnpm, knipArgs, windowRoot);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
