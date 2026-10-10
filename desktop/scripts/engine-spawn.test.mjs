import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const { engineSpawnOptions } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-spawn.js'));

const base = { env: {}, cwd: '/engine', logFd: 9 };

test('flag off keeps today\'s spawn: Windows child is not detached and stdio is piped', () => {
  const options = engineSpawnOptions({ ...base, platform: 'win32', detachedEngine: false });
  assert.equal(options.detached, false);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe', 'ipc']);
  assert.equal(options.windowsHide, true);
});

test('flag off on macOS and Linux stays detached with piped stdio', () => {
  for (const platform of ['darwin', 'linux']) {
    const options = engineSpawnOptions({ ...base, platform, detachedEngine: false });
    assert.equal(options.detached, true, platform);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe', 'ipc'], platform);
  }
});

test('flag on detaches the engine on every platform and writes output to the log fd, not a pipe', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const options = engineSpawnOptions({ ...base, platform, detachedEngine: true });
    assert.equal(options.detached, true, platform);
    assert.deepEqual(options.stdio, ['ignore', 9, 9, 'ipc'], platform);
    assert.equal(options.windowsHide, true, platform);
    assert.equal(options.cwd, '/engine', platform);
  }
});

test('flag on needs the log fd so the engine never writes to a pipe its UI can close', () => {
  assert.throws(() => engineSpawnOptions({ ...base, platform: 'win32', detachedEngine: true, logFd: undefined }), /log fd/);
});
