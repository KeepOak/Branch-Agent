// The local copy of CI's targeted strict typecheck (feature-batch-ci.mjs, Linux named-tests job): the engine's
// owned strict files under the engine tsconfig, then the window strict files. Heavy (~6 GB); run before pushing
// engine changes. Run from the repo root: node scripts/strict-typecheck.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTargetedStrictChecks } from './feature-batch-ci-typecheck.mjs';
import { typecheckSteps } from './window-typecheck.mjs';

export async function main() {
  // Use the engine's existing dist-artifact lock for admission across worktrees.
  await import('../engine/scripts/tsx.mjs');
  const { withHostHeavyStep } = await import('../engine/scripts/lib/host-heavy-step.mts');
  const { runManagedCommand } = await import('../engine/scripts/lib/managed-child-process.mts');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const runCheck = async (bin, args, cwd) => {
    const code = await runManagedCommand({ bin, args, cwd, env: process.env,
      signal: controller.signal, requireProcessTreeExit: process.platform !== 'win32' });
    if (code !== 0) throw new Error(`Strict typecheck command exited ${code}`);
  };
  try {
    return await withHostHeavyStep('typecheck', () => runAdmitted(runCheck), controller.signal);
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

async function runAdmitted(runCheck) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-strict-'));
  try {
    // CI builds the gateway packages before this check; the window files import their built types.
    for (const [cwd, args] of typecheckSteps().slice(0, 2)) {
      await runCheck(process.execPath, args, cwd);
    }
    await runTargetedStrictChecks(scratch, runCheck);
    console.log('strict typecheck passed (same files and options as CI)');
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
