import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gatewayPort } from './gateway-port.mjs';

test('tour gateway port requires isolated explicit target and refuses owner ports', () => {
  const data = mkdtempSync(join(tmpdir(), 'branch-tour-port-'));
  const scratch = mkdtempSync(join(tmpdir(), 'branch-tour-home-'));
  try {
    assert.throws(() => gatewayPort({ BRANCH_DESKTOP_DATA: data }), /VISUAL_GATEWAY_PORT or a BRANCH_HOME/);
    writeFileSync(join(data, 'gateway-port'), '19483\r\n');
    assert.throws(() => gatewayPort({ BRANCH_DESKTOP_DATA: data, VISUAL_GATEWAY_PORT: '19483' }), /refuses the owner/);
    assert.throws(() => gatewayPort({ BRANCH_DESKTOP_DATA: data, VISUAL_GATEWAY_PORT: '19031' }), /refuses the owner/);
    assert.throws(() => gatewayPort({ BRANCH_DESKTOP_DATA: data, BRANCH_HOME: data }), /desktop data folder/);
    writeFileSync(join(scratch, 'gateway-port'), '19652\r\n');
    assert.equal(gatewayPort({ BRANCH_DESKTOP_DATA: data, BRANCH_HOME: scratch }), '19652');
    assert.equal(gatewayPort({ BRANCH_DESKTOP_DATA: data, VISUAL_GATEWAY_PORT: '19651' }), '19651');
  } finally {
    rmSync(data, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
