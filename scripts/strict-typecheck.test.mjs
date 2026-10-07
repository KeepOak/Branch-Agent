import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('runs the same targeted strict check CI runs', async () => {
  const local = await readFile(new URL('./strict-typecheck.mjs', import.meta.url), 'utf8');
  const ci = await readFile(new URL('./feature-batch-ci.mjs', import.meta.url), 'utf8');
  assert.match(local, /runTargetedStrictChecks\(scratch\)/);
  assert.match(ci, /await runTargetedStrictChecks\(scratch\)/, 'CI no longer runs runTargetedStrictChecks; update the local copy');
});
