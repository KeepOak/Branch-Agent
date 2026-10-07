import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  REQUIRED_NODE,
  RESERVED_PORTS,
  isReservedPort,
  nodeMeetsMinimum,
  nodeUpgradeMessage,
  parseProofArgs,
} from './proof.mjs';

const installScript = resolve(dirname(fileURLToPath(import.meta.url)), 'cloud-agent-install.sh');

function nodeNeedsInstall(version) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      `source ${JSON.stringify(installScript)}; if node_needs_install ${JSON.stringify(version)}; then echo 0; else echo 1; fi`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').at(-1) === '0';
}

test('proof Node check accepts CI version and newer 24.x patches', () => {
  assert.equal(REQUIRED_NODE, '24.19.0');
  assert.equal(nodeMeetsMinimum('24.19.0'), true);
  assert.equal(nodeMeetsMinimum('24.19.1'), true);
  assert.equal(nodeMeetsMinimum('24.20.0'), true);
  assert.equal(nodeMeetsMinimum('26.1.0'), true);
  assert.equal(nodeMeetsMinimum('22.14.0'), false);
  assert.equal(nodeMeetsMinimum('24.18.0'), false);
  assert.equal(nodeMeetsMinimum('25.0.0'), false);
  assert.equal(nodeNeedsInstall(''), true);
  assert.equal(nodeNeedsInstall('22.14.0'), true);
  assert.equal(nodeNeedsInstall('24.15.0'), true);
  assert.equal(nodeNeedsInstall('24.16.0'), false);
  assert.equal(nodeNeedsInstall('24.19.0'), false);
  assert.equal(nodeNeedsInstall('26.1.0'), false);
  assert.equal(nodeNeedsInstall('26.2.0'), false);
  const dry = spawnSync('bash', [installScript, '--check-node'], { encoding: 'utf8', windowsHide: true });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^(ok|needs-install) /);
});

test('proof Node mismatch prints the install command for the CI version', () => {
  const message = nodeUpgradeMessage('22.14.0');
  assert.match(message, /nvm install 24\.19\.0/);
  assert.match(message, /n 24\.19\.0/);
  assert.match(message, /fnm install 24\.19\.0/);
  assert.match(message, /\.mts/);
});

test('proof --screens selects tour ids and reserved ports stay clear of the app and CI tour', () => {
  assert.deepEqual(parseProofArgs(['--screens', 'main-chat,settings-general']).screens, [
    'main-chat',
    'settings-general',
  ]);
  assert.deepEqual(parseProofArgs(['--screens=inbox,canopy-now']).screens, ['inbox', 'canopy-now']);
  assert.deepEqual(RESERVED_PORTS, [19031, 19032, 19651, 5651]);
  assert.equal(isReservedPort(19651), true);
  assert.equal(isReservedPort(20000), false);
});
