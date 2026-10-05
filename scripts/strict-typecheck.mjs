// The local copy of CI's targeted strict typecheck (feature-batch-ci.mjs, Linux named-tests job): the engine's
// owned strict files under the engine tsconfig, then the window strict files. Heavy (~6 GB); run before pushing
// engine changes. Run from the repo root: node scripts/strict-typecheck.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runTargetedStrictChecks } from './feature-batch-ci-typecheck.mjs';
import { typecheckSteps } from './window-typecheck.mjs';

export async function main() {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-strict-'));
  try {
    // CI builds the gateway packages before this check; the window files import their built types.
    for (const [cwd, args] of typecheckSteps().slice(0, 2)) {
      const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
    await runTargetedStrictChecks(scratch);
    console.log('strict typecheck passed (same files and options as CI)');
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
