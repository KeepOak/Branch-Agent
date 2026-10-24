import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const tour = fileURLToPath(new URL('./tour.mjs', import.meta.url));

test('tour refuses to start without BRANCH_DISPLAY_HOSTNAME', () => {
  for (const value of [undefined, '   ']) {
    const env = { ...process.env };
    delete env.BRANCH_DISPLAY_HOSTNAME;
    if (value !== undefined) env.BRANCH_DISPLAY_HOSTNAME = value;
    const run = spawnSync(process.execPath, [tour], { env, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /set BRANCH_DISPLAY_HOSTNAME/);
  }
});
