// Test the merge command checker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { baseContentFromHeadAndPatch, baseContentsFromPrDiff, checkMergeCommands, samePath } from './check-merge-command.mjs';

const STALE_AUTO = 'Use `gh pr merge <number> --auto --merge --match-head-commit <reviewed-sha>`.';
const CLEAN_MERGE = 'Use `gh pr merge <number> --merge --match-head-commit <reviewed-sha>`.';
const DOC_FILES = ['AGENTS.md', 'CONTRIBUTING.md', '.cursor/BUGBOT.md'];

async function runChecker(content, filename = 'AGENTS.md', options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'merge-check-'));
  const errors = [];
  try {
    await mkdir(join(dir, dirname(filename)), { recursive: true });
    await writeFile(join(dir, filename), content, 'utf8');
    const passed = checkMergeCommands(dir, [filename], {
      ...options,
      error: (...args) => errors.push(args.join(' ')),
    });
    return { passed, errors: errors.join('\n') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runDocs(heads, options, docs = DOC_FILES) {
  const dir = await mkdtemp(join(tmpdir(), 'merge-check-'));
  const errors = [];
  try {
    for (const [filename, content] of Object.entries(heads)) {
      await mkdir(join(dir, dirname(filename)), { recursive: true });
      await writeFile(join(dir, filename), content, 'utf8');
    }
    const passed = checkMergeCommands(dir, docs, {
      ...options,
      error: (...args) => errors.push(args.join(' ')),
    });
    return { passed, errors: errors.join('\n') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('accepts correct gh pr merge command', async () => {
  const content = 'Merge with `gh pr merge 123 --merge --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept correct command');
});

test('accepts REST API merge with merge_method and sha', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "merge", "sha": "abc123"}`.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept REST API with merge_method and sha');
});

test('rejects gh pr merge without --merge', async () => {
  const content = 'Use `gh pr merge 123 --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject command without --merge');
});

test('rejects gh pr merge without --match-head-commit', async () => {
  const content = 'Use `gh pr merge 123 --merge`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject command without --match-head-commit');
});

test('rejects gh pr merge with --squash', async () => {
  const content = 'Use `gh pr merge 123 --squash --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject --squash');
});

test('rejects gh pr merge with --rebase', async () => {
  const content = 'Use `gh pr merge 123 --rebase --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject --rebase');
});

test('rejects gh pr merge with --auto', async () => {
  const content = 'Use `gh pr merge 123 --auto --merge --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject --auto');
  assert.match(result.errors, /AGENTS\.md: merge command must not use --auto:/);
  assert.match(result.errors, /gh pr merge 123 --auto --merge --match-head-commit abc123/);
});

test('accepts file without merge commands', async () => {
  const content = 'This file has no merge commands.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept file without merge commands');
});

test('rejects REST API merge with squash', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "squash", "sha": "abc123"}`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject REST API with squash');
});

test('rejects REST API merge with rebase', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "rebase", "sha": "abc123"}`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject REST API with rebase');
});

test('rejects REST API merge without sha', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "merge"}`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject REST API without sha');
});

test('accepts correct REST API merge', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "merge", "sha": "abc123"}`.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept correct REST API merge');
});

test('rejects malformed merge_method even when merge appears nearby', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method":"merg","sha":"abc"}. The required value is "merge".`';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject malformed merge_method');
});

test('accepts valid REST merge followed by prose mentioning squash or rebase', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "merge", "sha": "abc123"}`. Do not substitute "squash" or "rebase".';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept valid payload when prose mentions squash or rebase');
});

test('stale base with old --auto lines and no doc changes passes', async () => {
  const heads = Object.fromEntries(DOC_FILES.map((doc) => [doc, `${STALE_AUTO}\nOther prose.\n`]));
  const baseContents = baseContentsFromPrDiff(DOC_FILES, {
    headContents: heads,
    prFiles: [{ filename: 'engine/src/port.ts', status: 'modified' }],
  });
  const result = await runDocs(heads, { baseContents });
  assert.equal(result.passed, true);
  assert.equal(result.errors, '');
});

test('rejects a pull request that adds an auto-merge command', async () => {
  const base = `${CLEAN_MERGE}\n`;
  const head = `${CLEAN_MERGE}\nAlso \`gh pr merge 44 --merge --auto --match-head-commit abc123\`.\n`;
  const result = await runChecker(head, 'AGENTS.md', { baseContents: { 'AGENTS.md': base } });
  assert.equal(result.passed, false);
  assert.match(result.errors, /AGENTS\.md: merge command must not use --auto:/);
  assert.match(result.errors, /gh pr merge 44 --merge --auto --match-head-commit abc123/);
});

test('passes when other lines change and the old --auto line remains from the base', async () => {
  const base = `Intro\n${STALE_AUTO}\nTopic: widgets\n`;
  const head = `Intro revised\n${STALE_AUTO}\nTopic: gadgets\n`;
  const baseContents = baseContentsFromPrDiff(['CONTRIBUTING.md'], {
    headContents: { 'CONTRIBUTING.md': head },
    prFiles: [{ filename: 'CONTRIBUTING.md', status: 'modified' }],
    baseContentsForChanged: { 'CONTRIBUTING.md': base },
  });
  const result = await runChecker(head, 'CONTRIBUTING.md', { baseContents });
  assert.equal(result.passed, true, result.errors);
});

test('pull request diff adds an auto-merge line and keeps an old one only when it was already there', async () => {
  const addedHead = `${CLEAN_MERGE}\nAlso \`gh pr merge 44 --merge --auto --match-head-commit abc123\`.\n`;
  const addedPatch = [
    '@@ -1 +1,2 @@',
    ` ${CLEAN_MERGE}`,
    '+Also `gh pr merge 44 --merge --auto --match-head-commit abc123`.',
  ].join('\n');
  const addedBase = baseContentFromHeadAndPatch(addedHead, addedPatch);
  const added = await runChecker(addedHead, 'AGENTS.md', {
    baseContents: { 'AGENTS.md': addedBase },
  });
  assert.equal(added.passed, false);
  assert.match(added.errors, /AGENTS\.md: merge command must not use --auto:/);
  assert.match(added.errors, /gh pr merge 44 --merge --auto --match-head-commit abc123/);

  const keptHead = `Intro revised\n${STALE_AUTO}\nTopic: gadgets\n`;
  const keptPatch = ['@@ -1,3 +1,3 @@', '-Intro', '+Intro revised', ` ${STALE_AUTO}`, '-Topic: widgets', '+Topic: gadgets'].join('\n');
  const keptBase = baseContentFromHeadAndPatch(keptHead, keptPatch);
  const kept = await runChecker(keptHead, 'CONTRIBUTING.md', {
    baseContents: { 'CONTRIBUTING.md': keptBase },
  });
  assert.equal(kept.passed, true, kept.errors);
});

test('falls back to main when the merge base is unavailable', async () => {
  const head = `${STALE_AUTO}\n`;
  const result = await runChecker(head, '.cursor/BUGBOT.md', {
    baseContents: { '.cursor/BUGBOT.md': null },
    mainContents: { '.cursor/BUGBOT.md': `${CLEAN_MERGE}\n` },
  });
  assert.equal(result.passed, true, result.errors);
});

test('fallback still rejects an auto-merge command that is on main', async () => {
  const result = await runChecker('unrelated head\n', 'AGENTS.md', {
    baseContents: { 'AGENTS.md': null },
    mainContents: { 'AGENTS.md': `${STALE_AUTO}\n` },
  });
  assert.equal(result.passed, false);
  assert.match(result.errors, /AGENTS\.md: merge command must not use --auto:/);
});

function foldWinPath(value) {
  return String(value).replaceAll('/', '\\').replace(/\\+$/g, '').toLowerCase();
}

function nativeRealpathOrReason(value) {
  try {
    return realpathSync.native(value);
  } catch (error) {
    return `unavailable: ${error?.message ?? error}`;
  }
}

// Node's default Windows quoting wraps the /c argument and backslash-escapes
// inner quotes. cmd does not treat \" as a quote, and /s then strips the outer
// quotes, so %~sI can echo a path that is not on disk. Pass the command
// through verbatim so cmd sees for %I in ("<dir>") do @echo %~sI.
function windowsShortPath(dir) {
  const command = `"for %I in ("${String(dir).replaceAll('"', '')}") do @echo %~sI"`;
  const output = execFileSync('cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = String(output)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}

test('samePath equates Windows short names and slash styles', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'merge-check-path-'));
  try {
    assert.equal(samePath(dir, dir), true);

    if (process.platform !== 'win32') return;

    const forward = dir.replaceAll('\\', '/');
    const backward = dir.replaceAll('/', '\\');
    assert.equal(samePath(forward, backward), true);
    assert.equal(samePath(backward, dir), true);
    assert.equal(samePath(forward, dir), true);

    let short = '';
    try {
      short = windowsShortPath(dir);
    } catch {
      short = '';
    }
    if (!short || !existsSync(short) || foldWinPath(short) === foldWinPath(dir)) {
      t.diagnostic(
        `skipping short-name assert: need a distinct existing 8.3 path (short=${JSON.stringify(short)}, dir=${JSON.stringify(dir)})`,
      );
      return;
    }
    const detail = `short=${JSON.stringify(short)} dir=${JSON.stringify(dir)} nativeRealpath(short)=${JSON.stringify(nativeRealpathOrReason(short))}`;
    assert.equal(samePath(short, dir), true, detail);
    assert.equal(samePath(short.replaceAll('\\', '/'), dir), true, detail);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? '';
    const stdout = error?.stdout?.toString?.() ?? '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout || error.message}`);
  }
}

async function initRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'merge-check-git-'));
  git(dir, ['init', '-b', 'main']);
  return dir;
}

async function writeDocs(dir, files) {
  for (const [filename, content] of Object.entries(files)) {
    await mkdir(join(dir, dirname(filename)), { recursive: true });
    await writeFile(join(dir, filename), content, 'utf8');
  }
}

function commitAll(dir, message) {
  git(dir, ['add', '--', '.']);
  git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-m', message]);
}

test('git: stale branch that does not edit docs passes', async () => {
  const dir = await initRepo();
  try {
    const stale = Object.fromEntries(DOC_FILES.map((doc) => [doc, `${STALE_AUTO}\n`]));
    await writeDocs(dir, stale);
    commitAll(dir, 'base');
    const base = git(dir, ['rev-parse', 'HEAD']).trim();
    const clean = Object.fromEntries(DOC_FILES.map((doc) => [doc, `${CLEAN_MERGE}\n`]));
    await writeDocs(dir, clean);
    commitAll(dir, 'drop auto');
    git(dir, ['checkout', '-b', 'feature', base]);
    await writeDocs(dir, { 'README.md': 'unrelated\n' });
    commitAll(dir, 'unrelated');
    const errors = [];
    const passed = checkMergeCommands(dir, DOC_FILES, {
      error: (...args) => errors.push(args.join(' ')),
    });
    assert.equal(passed, true, errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('git: branch that adds an auto-merge command fails', async () => {
  const dir = await initRepo();
  try {
    await writeDocs(dir, { 'AGENTS.md': `${CLEAN_MERGE}\n` });
    commitAll(dir, 'clean');
    git(dir, ['checkout', '-b', 'feature']);
    await writeDocs(dir, {
      'AGENTS.md': `${CLEAN_MERGE}\nRun \`gh pr merge 44 --merge --auto --match-head-commit abc123\`.\n`,
    });
    commitAll(dir, 'add auto');
    const errors = [];
    const passed = checkMergeCommands(dir, ['AGENTS.md'], {
      error: (...args) => errors.push(args.join(' ')),
    });
    assert.equal(passed, false);
    const text = errors.join('\n');
    assert.match(text, /AGENTS\.md: merge command must not use --auto:/);
    assert.match(text, /gh pr merge 44 --merge --auto --match-head-commit abc123/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('git: editing other doc lines while the old --auto line remains passes', async () => {
  const dir = await initRepo();
  try {
    await writeDocs(dir, { 'AGENTS.md': `Intro\n${STALE_AUTO}\nTopic: widgets\n` });
    commitAll(dir, 'base');
    const base = git(dir, ['rev-parse', 'HEAD']).trim();
    await writeDocs(dir, { 'AGENTS.md': `Intro\n${CLEAN_MERGE}\nTopic: widgets\n` });
    commitAll(dir, 'drop auto on main');
    git(dir, ['checkout', '-b', 'feature', base]);
    await writeDocs(dir, { 'AGENTS.md': `Intro revised\n${STALE_AUTO}\nTopic: gadgets\n` });
    commitAll(dir, 'edit other lines');
    const errors = [];
    const passed = checkMergeCommands(dir, ['AGENTS.md'], {
      error: (...args) => errors.push(args.join(' ')),
    });
    assert.equal(passed, true, errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('git: shallow merge checkout ignores stale head lines and rejects an added auto command', async () => {
  const origin = await initRepo();
  const staleCheckout = await mkdtemp(join(tmpdir(), 'merge-check-shallow-'));
  const addedCheckout = await mkdtemp(join(tmpdir(), 'merge-check-shallow-'));
  try {
    await writeDocs(origin, { 'AGENTS.md': `${STALE_AUTO}\n` });
    commitAll(origin, 'base');
    const base = git(origin, ['rev-parse', 'HEAD']).trim();
    await writeDocs(origin, { 'AGENTS.md': `${CLEAN_MERGE}\n` });
    commitAll(origin, 'drop auto');
    git(origin, ['checkout', '-b', 'feature', base]);
    await writeDocs(origin, { 'README.md': 'unrelated\n' });
    commitAll(origin, 'unrelated');
    git(origin, ['merge', 'main', '-m', 'merge main']);
    git(staleCheckout, ['init', '-b', 'main']);
    git(staleCheckout, ['-c', 'protocol.file.allow=always', 'fetch', '--depth=2', origin, 'feature']);
    git(staleCheckout, ['checkout', '--detach', 'FETCH_HEAD']);
    const staleErrors = [];
    const stalePassed = checkMergeCommands(staleCheckout, ['AGENTS.md'], {
      error: (...args) => staleErrors.push(args.join(' ')),
    });
    assert.equal(stalePassed, true, staleErrors.join('\n'));

    git(origin, ['checkout', 'main']);
    git(origin, ['checkout', '-b', 'adds-auto']);
    await writeDocs(origin, {
      'AGENTS.md': `${CLEAN_MERGE}\nRun \`gh pr merge 44 --merge --auto --match-head-commit abc123\`.\n`,
    });
    commitAll(origin, 'add auto');
    git(origin, ['checkout', 'main']);
    git(origin, ['merge', 'adds-auto', '-m', 'merge added auto']);
    git(addedCheckout, ['init', '-b', 'main']);
    git(addedCheckout, ['-c', 'protocol.file.allow=always', 'fetch', '--depth=2', origin, 'main']);
    git(addedCheckout, ['checkout', '--detach', 'FETCH_HEAD']);
    const addedErrors = [];
    const addedPassed = checkMergeCommands(addedCheckout, ['AGENTS.md'], {
      error: (...args) => addedErrors.push(args.join(' ')),
    });
    assert.equal(addedPassed, false);
    assert.match(addedErrors.join('\n'), /AGENTS\.md: merge command must not use --auto:/);
  } finally {
    await rm(origin, { recursive: true, force: true });
    await rm(staleCheckout, { recursive: true, force: true });
    await rm(addedCheckout, { recursive: true, force: true });
  }
});

test('git: unrelated history falls back to main instead of the head', async () => {
  const dir = await initRepo();
  try {
    await writeDocs(dir, { 'AGENTS.md': `${CLEAN_MERGE}\n` });
    commitAll(dir, 'main clean');
    git(dir, ['checkout', '--orphan', 'stale']);
    await writeDocs(dir, { 'AGENTS.md': `${STALE_AUTO}\n` });
    commitAll(dir, 'stale head');
    const errors = [];
    const passed = checkMergeCommands(dir, ['AGENTS.md'], {
      error: (...args) => errors.push(args.join(' ')),
    });
    assert.equal(passed, true, errors.join('\n'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
