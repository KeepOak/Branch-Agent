import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineSignature, resolveEngineDir } from '../dist/config.js';

test('published engine wins over the source checkout, and broken publication is surfaced', () => {
  const root = mkdtempSync(join(tmpdir(), 'branch-launcher-config-'));
  try {
    const dataDir = join(root, 'data');
    const source = join(root, 'source');
    const published = join(root, 'published');
    mkdirSync(dataDir);
    for (const dir of [source, published]) {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'branch.mjs'), '');
      writeFileSync(join(dir, 'dist', 'build-info.json'), '{}');
    }
    const cfg = { dataDir, engineDir: source };
    assert.equal(resolveEngineDir(cfg), source);
    writeFileSync(join(dataDir, 'engine-current.txt'), `${published}\n`);
    assert.equal(resolveEngineDir(cfg), published);
    writeFileSync(join(dataDir, 'engine-current.txt'), join(root, 'missing'));
    assert.throws(() => resolveEngineDir(cfg), /published Branch engine is incomplete/);
    assert.doesNotThrow(() => engineSignature(cfg), 'bad pending publication must not kill the running app');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
