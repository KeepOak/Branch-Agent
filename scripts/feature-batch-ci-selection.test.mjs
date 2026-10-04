import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectChangedTests } from './feature-batch-ci-selection.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('selects added and modified regression files as literal lane names', () => {
  assert.deepEqual(selectChangedTests([
    'window/src/thread/new-regression.test.tsx', 'engine/src/coding/changed.test.ts',
    'engine/extensions/browser/src/new.test.ts', 'window/src/thread/new-regression.test.tsx',
    'window/src/thread/component.tsx', 'scripts/unrelated.test.ts',
  ]), { engine: ['src/coding/changed.test.ts', 'extensions/browser/src/new.test.ts'],
    window: ['src/thread/new-regression.test.tsx'] });
});

test('rejects traversal, unsupported roots and pattern expansion', () => {
  for (const file of ['window/src/../escape.test.ts', 'engine/test/all.test.ts',
    'window/src/*.test.ts', 'engine/src//double.test.ts', 'engine/src/a\\b.test.ts']) {
    assert.throws(() => selectChangedTests([file]), /Invalid changed feature test path/);
  }
});

test('an empty diff adds no suites and configs still fail on no tests', async () => {
  assert.deepEqual(selectChangedTests([]), { engine: [], window: [] });
  const { readFile } = await import('node:fs/promises');
  for (const lane of ['engine', 'window']) {
    const source = await readFile(new URL(`./feature-batch-ci-${lane}.config.mjs`, import.meta.url), 'utf8');
    assert.match(source, /include: namedTests/);
    assert.match(source, /passWithNoTests: false/);
  }
});

test('real base diff extends named suites without selecting deleted or untouched tests', async () => {
  const scratch = process.platform === 'win32'
    ? path.join(os.tmpdir(), 'Codex-session-files') : os.tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'branch-ci-selection-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'window/src'), { recursive: true });
    for (const name of ['targets', 'selection']) {
      await copyFile(new URL(`./feature-batch-ci-${name}.mjs`, import.meta.url),
        path.join(root, `scripts/feature-batch-ci-${name}.mjs`));
    }
    for (const name of ['modified', 'deleted', 'untouched']) {
      await writeFile(path.join(root, `window/src/${name}.test.ts`), '// base');
    }
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    await writeFile(path.join(root, 'window/src/modified.test.ts'), '// modified');
    await writeFile(path.join(root, 'window/src/added.test.tsx'), '// added');
    await rm(path.join(root, 'window/src/deleted.test.ts'));
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'head');
    const source = 'import { namedTests } from "./scripts/feature-batch-ci-targets.mjs"; console.log(JSON.stringify(namedTests("window")))';
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', source],
      { cwd: root, encoding: 'utf8', env: { ...process.env, BRANCH_FEATURE_BASE_SHA: base } });
    const files = JSON.parse(output);
    assert(files.includes('src/added.test.tsx'));
    assert(files.includes('src/modified.test.ts'));
    assert(!files.includes('src/deleted.test.ts'));
    assert(!files.includes('src/untouched.test.ts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
