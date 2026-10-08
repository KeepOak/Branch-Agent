// Test the merge command checker.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkMergeCommands } from './check-merge-command.mjs';

async function runChecker(content, filename = 'AGENTS.md') {
  const dir = await mkdtemp(join(tmpdir(), 'merge-check-'));
  try {
    await writeFile(join(dir, filename), content, 'utf8');
    const passed = checkMergeCommands(dir, [filename]);
    return { passed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('accepts correct gh pr merge command', async () => {
  const content = 'Merge with `gh pr merge 123 --auto --merge --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept correct command');
});

test('accepts REST API merge with merge_method and sha', async () => {
  const content = 'Use `PUT /repos/KeepOak/Branch-Agent/pulls/123/merge` with `{"merge_method": "merge", "sha": "abc123"}`.';
  const result = await runChecker(content);
  assert.ok(result.passed, 'Should accept REST API with merge_method and sha');
});

test('rejects gh pr merge without --merge', async () => {
  const content = 'Use `gh pr merge 123 --auto --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject command without --merge');
});

test('rejects gh pr merge without --match-head-commit', async () => {
  const content = 'Use `gh pr merge 123 --auto --merge`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject command without --match-head-commit');
});

test('rejects gh pr merge with --squash', async () => {
  const content = 'Use `gh pr merge 123 --auto --squash --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject --squash');
});

test('rejects gh pr merge with --rebase', async () => {
  const content = 'Use `gh pr merge 123 --auto --rebase --match-head-commit abc123`.';
  const result = await runChecker(content);
  assert.ok(!result.passed, 'Should reject --rebase');
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
