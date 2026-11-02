import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkNamedTests } from './check-named-tests.mjs';

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'named-tests-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, stdio: 'pipe' });
  const write = (file, text) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); };
  git('init', '-q', '-b', 'main');
  write('README.md', 'x\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'fix/thing');
  return { dir, git, write };
}

test('missing list names the expected file and every line to add', () => {
  const r = repo();
  try {
    r.write('engine/src/a.test.ts', '');
    r.write('window/src/b.test.tsx', '');
    r.write('engine/src/a.ts', '');
    r.git('add', '-A'); r.git('commit', '-qm', 'tests');
    const out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /scripts\/feature-batch-ci-named\/fix-thing\.txt/);
    assert.match(out.text, /engine:src\/a\.test\.ts window:src\/b\.test\.tsx/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('partial list prints only the missing lines; full list passes', () => {
  const r = repo();
  try {
    r.write('engine/src/a.test.ts', '');
    r.write('engine/src/c.test.ts', '');
    r.write('scripts/feature-batch-ci-named/fix-thing.txt', '# list\nengine:src/a.test.ts\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'tests');
    let out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /lacks engine:src\/c\.test\.ts\. Fix: add the line engine:src\/c\.test\.ts/);
    assert.doesNotMatch(out.text, /lacks engine:src\/a\.test\.ts/);
    r.write('scripts/feature-batch-ci-named/fix-thing.txt', 'engine:src/c.test.ts\nengine:src/a.test.ts\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'list');
    out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 0);
    assert.match(out.text, /preflight: ok/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('deleting a test passes without a list; a renamed test needs only its new name', () => {
  const r = repo();
  try {
    r.write('engine/src/gone.test.ts', 'x\n');
    r.write('engine/src/old.test.ts', 'a\nb\nc\nd\n');
    r.write('scripts/ci-uncovered-baseline/engine-src.txt', 'engine:src/old.test.ts\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'tests');
    r.git('branch', '-qf', 'main');
    r.git('rm', '-q', 'engine/src/gone.test.ts');
    r.git('commit', '-qm', 'delete');
    assert.equal(checkNamedTests({ cwd: r.dir, base: 'main' }).exitCode, 0);
    r.git('mv', 'engine/src/old.test.ts', 'engine/src/new.test.ts');
    r.git('rm', '-q', 'scripts/ci-uncovered-baseline/engine-src.txt');
    r.git('commit', '-qm', 'rename');
    const out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /lines: engine:src\/new\.test\.ts\. Fix|lines: engine:src\/new\.test\.ts$/m);
    assert.doesNotMatch(out.text, /old\.test\.ts/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('no changed test files passes without a list', () => {
  const r = repo();
  try {
    r.write('engine/src/a.ts', '');
    r.git('add', '-A'); r.git('commit', '-qm', 'src');
    assert.equal(checkNamedTests({ cwd: r.dir, base: 'main' }).exitCode, 0);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('pre-push accepts a new baseline or local-only entry with a warning; CI checks the review marker', () => {
  const r = repo();
  try {
    r.git('checkout', '-q', 'main');
    r.write('engine/src/old.test.ts', 'x\n');
    r.write('scripts/ci-uncovered-baseline/engine-src.txt', 'engine:src/old.test.ts\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'baseline');
    r.git('checkout', '-q', 'fix/thing');
    r.git('merge', '-q', '--ff-only', 'main');
    r.write('scripts/ci-uncovered-baseline/engine-src.txt', '');
    r.write('scripts/ci-local-only-tests.txt', 'engine:src/old.test.ts\n');
    r.git('add', '-A'); r.git('commit', '-qm', 'move to local-only');
    let out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 0, out.text);
    assert.match(out.text, /Warning: New local-only entry: engine\/src\/old.test.ts; CI requires gate-change-reviewed/);
    r.write('scripts/ci-local-only-tests.txt', '');
    r.git('add', '-A'); r.git('commit', '-qm', 'drop it');
    out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /Uncovered test: engine\/src\/old.test.ts/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test('full-tree pre-push rejects an unchanged dangling named entry', () => {
  const r = repo();
  try {
    r.write('scripts/feature-batch-ci-named/old.txt', 'engine:src/missing.test.ts\n');
    r.git('add', '--', 'scripts/feature-batch-ci-named/old.txt');
    r.git('commit', '-qm', 'list');
    r.git('branch', '-qf', 'main');
    const out = checkNamedTests({ cwd: r.dir, base: 'main' });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /CI selector names missing file: engine\/src\/missing.test.ts/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});
