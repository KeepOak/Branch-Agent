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

test('no changed test files passes without a list', () => {
  const r = repo();
  try {
    r.write('engine/src/a.ts', '');
    r.git('add', '-A'); r.git('commit', '-qm', 'src');
    assert.equal(checkNamedTests({ cwd: r.dir, base: 'main' }).exitCode, 0);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});
