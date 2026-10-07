// The local copy of CI's strict window type check (feature-slice-ci.mjs "strict-window"): build the two engine
// packages the window imports, then `tsc --build window/tsconfig.json`. Run: pnpm -C window typecheck
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = path.join(root, 'engine');
const windowRoot = path.join(root, 'window');

/** The commands CI runs for strict-window, in order, as [cwd, node args]. */
export function typecheckSteps() {
  const packages = ['gateway-protocol', 'gateway-client'].map(name =>
    [engineRoot, ['--import', './scripts/tsx.mjs', 'scripts/build-workspace-package.mts', name]]);
  const tsc = path.join(windowRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  return [...packages, [windowRoot, [tsc, '--build', path.join(windowRoot, 'tsconfig.json'), '--pretty']]];
}

function main() {
  for (const [cwd, args] of typecheckSteps()) {
    const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log('window strict type check passed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
