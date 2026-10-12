// node --test scripts/check-copied-csv.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCopiedAndHarvest,
  checkCopiedCsv,
  checkCopiedFiles,
  copiedHeader,
  copiedShardsOnDisk,
  harvestEntriesFrom,
  missingCopiedForAddedHarvest,
  parseCsvLine,
} from './check-copied-csv.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { harvestE2eError } from './feature-batch-ci-targets.mjs';

const row = (path, note = 'up') => `${path},ATLAS-1,openclaw/openclaw,abc123,${note},2026-10-06`;

test('parses quoted commas as one CSV field', () => {
  assert.deepEqual(parseCsvLine('a,"b, c",d'), ['a', 'b, c', 'd']);
  assert.deepEqual(parseCsvLine('a,"say ""hi""",d'), ['a', 'say "hi"', 'd']);
  assert.equal(parseCsvLine(row('engine/src/foo.test.ts', '"src/foo.test.ts (changed: a, b)"')).length, 6);
});

test('accepts one header, six columns, unique rows', () => {
  const text = `${copiedHeader}\n${row('engine/src/a.test.ts')}\n${row('engine/src/b.test.ts')}\n`;
  assert.deepEqual(checkCopiedCsv(text).errors, []);
});

test('rejects missing or duplicate header rows', () => {
  assert.match(checkCopiedCsv(`${row('engine/src/a.test.ts')}\n`).errors.join('\n'), /exactly one header row \(found 0\)/);
  const doubled = `${copiedHeader}\n${row('engine/src/a.test.ts')}\n${copiedHeader}\n`;
  assert.match(checkCopiedCsv(doubled).errors.join('\n'), /exactly one header row \(found 2\)/);
});

test('rejects a row that does not have exactly six columns', () => {
  const text = `${copiedHeader}\nengine/src/a.test.ts,ATLAS-1,openclaw/openclaw,abc123,up,2026-10-06,extra\n`;
  assert.match(checkCopiedCsv(text).errors.join('\n'), /exactly 6 columns \(found 7\)/);
  const short = `${copiedHeader}\nengine/src/a.test.ts,ATLAS-1,openclaw/openclaw\n`;
  assert.match(checkCopiedCsv(short).errors.join('\n'), /exactly 6 columns \(found 3\)/);
});

test('rejects an exact duplicate row', () => {
  const dup = row('engine/src/a.test.ts');
  const text = `${copiedHeader}\n${dup}\n${dup}\n`;
  assert.match(checkCopiedCsv(text).errors.join('\n'), /exact duplicate of line 2/);
});

test('Harvest list lines map to COPIED.csv branch_path values', () => {
  assert.deepEqual(harvestEntriesFrom('# skip\nengine:src/foo.test.ts\nwindow:src/bar.test.tsx\n'), [
    'engine/src/foo.test.ts',
    'window/src/bar.test.tsx',
  ]);
});

test('only newly added Harvest files require a COPIED.csv row', () => {
  const csvText = `${copiedHeader}\n${row('engine/src/new.test.ts')}\n`;
  const headHarvest = new Set(['engine/src/new.test.ts', 'engine/src/old.test.ts']);
  const baseHarvest = new Set(['engine/src/old.test.ts']);
  assert.deepEqual(checkCopiedAndHarvest({ csvText, headHarvest, baseHarvest }), []);
  assert.deepEqual(
    missingCopiedForAddedHarvest(new Set(['engine/src/old.test.ts']), new Set()),
    ['engine/src/old.test.ts'],
  );
  const missing = checkCopiedAndHarvest({
    csvText,
    headHarvest: new Set(['engine/src/new.test.ts', 'engine/src/ghost.test.ts']),
    baseHarvest: new Set(),
  });
  assert.deepEqual(missing.filter((error) => error.includes('Harvest list')), [
    'Harvest list added engine/src/ghost.test.ts with no row in docs/upstream/COPIED.csv or docs/upstream/copied/*.csv',
  ]);
});

test('Harvest lists reject e2e files that the e2e suite should run', () => {
  assert.match(harvestE2eError('engine', 'src/foo.e2e.test.ts'), /e2e suite/);
  assert.match(harvestE2eError('window', 'src/foo.e2e.test.tsx'), /e2e suite/);
  assert.equal(harvestE2eError('engine', 'src/foo.test.ts'), undefined);
});

test('quoted COPIED.csv fields keep a six-column row with an inner comma', () => {
  const text = `${copiedHeader}\nengine/src/a.test.ts,ATLAS-1,openclaw/openclaw,abc123,"src/a.test.ts (changed: foo, bar)",2026-10-06\n`;
  assert.deepEqual(checkCopiedCsv(text).errors, []);
});

const shard = (name, ...rows) => ({ path: `docs/upstream/copied/${name}.csv`, text: `${copiedHeader}\n${rows.join('\n')}\n` });

test('a shard row satisfies the Harvest requirement for a newly added file', () => {
  const csvText = `${copiedHeader}\n${row('engine/src/old.test.ts')}\n`;
  const errors = checkCopiedAndHarvest({
    csvText,
    shards: [shard('atlas-card-1', row('engine/src/new.test.ts'))],
    headHarvest: new Set(['engine/src/old.test.ts', 'engine/src/new.test.ts']),
    baseHarvest: new Set(['engine/src/old.test.ts']),
  });
  assert.deepEqual(errors, []);
  const withoutShard = checkCopiedAndHarvest({
    csvText,
    headHarvest: new Set(['engine/src/old.test.ts', 'engine/src/new.test.ts']),
    baseHarvest: new Set(['engine/src/old.test.ts']),
  });
  assert.equal(withoutShard.length, 1);
  assert.match(withoutShard[0], /Harvest list added engine\/src\/new\.test\.ts with no row/);
});

test('an exact duplicate across a shard and COPIED.csv fails', () => {
  const dup = row('engine/src/a.test.ts');
  const errors = checkCopiedAndHarvest({
    csvText: `${copiedHeader}\n${dup}\n`,
    shards: [shard('atlas-card-2', dup)],
    headHarvest: new Set(),
    baseHarvest: new Set(),
  });
  assert.deepEqual(errors, [
    'docs/upstream/copied/atlas-card-2.csv:2 is an exact duplicate of docs/upstream/COPIED.csv:2',
  ]);
  const twoShards = checkCopiedFiles([shard('a', dup), shard('b', dup)]);
  assert.deepEqual(twoShards.errors, ['docs/upstream/copied/b.csv:2 is an exact duplicate of docs/upstream/copied/a.csv:2']);
});

test('a shard with a bad or missing header fails', () => {
  const bad = { path: 'docs/upstream/copied/bad.csv', text: `branch_path,atlas_id,project,commit,upstream,date\n${row('engine/src/a.test.ts')}\n` };
  const errors = checkCopiedAndHarvest({ csvText: `${copiedHeader}\n`, shards: [bad], headHarvest: new Set(), baseHarvest: new Set() });
  assert.deepEqual(errors, [`docs/upstream/copied/bad.csv header must be ${copiedHeader}`]);
  const missing = checkCopiedFiles([{ path: 'docs/upstream/copied/none.csv', text: `${row('engine/src/a.test.ts')}\n` }]);
  assert.deepEqual(missing.errors, ['docs/upstream/copied/none.csv must have exactly one header row (found 0)']);
  const wide = checkCopiedFiles([shard('wide', `${row('engine/src/a.test.ts')},extra`)]);
  assert.match(wide.errors.join('\n'), /wide\.csv:2 must have exactly 6 columns \(found 7\)/);
});

test('shards on disk are the .csv files in docs/upstream/copied, in name order', () => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'copied-shards-'));
  try {
    assert.deepEqual(copiedShardsOnDisk(dir), []);
    mkdirSync(nodePath.join(dir, 'docs/upstream/copied'), { recursive: true });
    writeFileSync(nodePath.join(dir, 'docs/upstream/copied/b.csv'), 'B');
    writeFileSync(nodePath.join(dir, 'docs/upstream/copied/a.csv'), 'A');
    writeFileSync(nodePath.join(dir, 'docs/upstream/copied/notes.md'), 'ignored');
    assert.deepEqual(copiedShardsOnDisk(dir), [
      { path: 'docs/upstream/copied/a.csv', text: 'A' },
      { path: 'docs/upstream/copied/b.csv', text: 'B' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
