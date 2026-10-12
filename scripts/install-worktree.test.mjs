import assert from 'node:assert/strict';
import test from 'node:test';
import { installArgs, lanesFor } from './install-worktree.mjs';

test('installs like CI: frozen, no scripts, hardlinked, with the verified exceptions', () => {
  const flags = ['--config.minimum-release-age-exclude=nodemailer@10.0.13'];
  const args = installArgs(flags);
  assert.equal(args[0], 'install');
  for (const flag of ['--frozen-lockfile', '--ignore-scripts', '--prefer-offline', '--package-import-method=hardlink']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.deepEqual(args.slice(-1), flags);
});

test('picks engine, window or both and refuses anything else', () => {
  assert.deepEqual(lanesFor('both'), ['engine', 'window']);
  assert.deepEqual(lanesFor('window'), ['window']);
  assert.throws(() => lanesFor('desktop'), /usage/);
});
