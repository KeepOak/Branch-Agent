import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('native Windows fixture paths remain valid JSON and existing config is preserved', () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-launcher-seed-'));
  try {
    const source = join(root, 'source');
    const target = join(root, 'target');
    const relative = ['home', '.branch', 'branch.json'];
    mkdirSync(join(source, 'home', '.branch'), { recursive: true });
    const sourceSlash = source.replaceAll('\\', '/');
    writeFileSync(join(source, ...relative), JSON.stringify({ forward: `${sourceSlash}/workspace`, native: `${source}\\workspace` }));
    const helper = fileURLToPath(new URL('./seed-data.mjs', import.meta.url));
    execFileSync(process.execPath, [helper, source, target], { stdio: 'pipe' });
    const targetFile = join(target, ...relative);
    const value = JSON.parse(readFileSync(targetFile, 'utf8'));
    assert.equal(value.forward, `${target.replaceAll('\\', '/')}/workspace`);
    assert.equal(value.native.replaceAll('\\', '/'), `${target.replaceAll('\\', '/')}/workspace`);
    writeFileSync(targetFile, '{"keep":"existing"}');
    execFileSync(process.execPath, [helper, source, target], { stdio: 'pipe' });
    assert.equal(readFileSync(targetFile, 'utf8'), '{"keep":"existing"}');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
