import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_NODE,
  RESERVED_PORTS,
  isReservedPort,
  nodeMeetsMinimum,
  nodeUpgradeMessage,
  parseProofArgs,
} from './proof.mjs';

test('proof Node check accepts CI version and newer 24.x patches', () => {
  assert.equal(REQUIRED_NODE, '24.19.0');
  assert.equal(nodeMeetsMinimum('24.19.0'), true);
  assert.equal(nodeMeetsMinimum('24.19.1'), true);
  assert.equal(nodeMeetsMinimum('24.20.0'), true);
  assert.equal(nodeMeetsMinimum('26.1.0'), true);
  assert.equal(nodeMeetsMinimum('22.14.0'), false);
  assert.equal(nodeMeetsMinimum('24.18.0'), false);
  assert.equal(nodeMeetsMinimum('25.0.0'), false);
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
