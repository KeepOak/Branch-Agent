import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { typecheckSteps } from './window-typecheck.mjs';

test('runs what CI strict-window runs: both gateway packages, then tsc --build window/tsconfig.json', async () => {
  const steps = typecheckSteps();
  assert.deepEqual(steps.slice(0, 2).map(([, args]) => args.at(-1)), ['gateway-protocol', 'gateway-client']);
  const [, tscArgs] = steps[2];
  assert.ok(tscArgs.includes('--build'));
  assert.match(tscArgs[tscArgs.indexOf('--build') + 1], /window[\\/]tsconfig\.json$/);
  const ci = await readFile(new URL('./feature-slice-ci.mjs', import.meta.url), 'utf8');
  assert.match(ci, /'--build', path\.join\(windowRoot, 'tsconfig\.json'\)/, 'CI changed its strict-window command');
  assert.match(ci, /\['gateway-protocol', 'gateway-client'\]/, 'CI changed the packages it builds first');
});

test('is wired as pnpm -C window typecheck', async () => {
  const pkg = JSON.parse(await readFile(new URL('../window/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.typecheck, 'node ../scripts/window-typecheck.mjs');
});
