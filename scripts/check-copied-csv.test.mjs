// node --test scripts/check-copied-csv.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCopiedAndHarvest,
  checkCopiedCsv,
  copiedHeader,
  harvestEntriesFrom,
  missingCopiedForAddedHarvest,
  parseCsvLine,
} from './check-copied-csv.mjs';
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
    'Harvest list added engine/src/ghost.test.ts with no docs/upstream/COPIED.csv row',
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
