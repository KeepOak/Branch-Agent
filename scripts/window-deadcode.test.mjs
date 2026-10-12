import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { KNIP, knipArgs } from './window-deadcode.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('window dead-code gate runs the same pinned Knip as the engine', () => {
  const engine = JSON.parse(fs.readFileSync(path.join(repoRoot, 'engine/package.json'), 'utf8'));
  const pinned = engine.scripts['deadcode:knip'].match(/--package (knip@[\d.]+)/)?.[1];
  assert.equal(KNIP, pinned);
  assert.deepEqual(knipArgs.slice(0, 4), ['dlx', '--package', KNIP, 'knip']);
});

test('window dead-code gate reports every issue type', () => {
  // No --include, --exclude or --production: unused files, exports, types, duplicates and dependencies all fail.
  assert(!knipArgs.some(arg => /^--(include|exclude|production|no-exit-code)/.test(arg)));
});

test('every knip.jsonc entry and allowlist line carries a reason', () => {
  const lines = fs.readFileSync(path.join(repoRoot, 'window/knip.jsonc'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex(line => /"(entry|ignoreIssues)"/.test(line));
  let reasoned = false;
  for (const line of lines.slice(start)) {
    const text = line.trim();
    if (text.startsWith('//')) { reasoned = true; continue; }
    if (/^"[^"]+"(\s*:\s*\[[^\]]*\])?,?$/.test(text)) {
      assert(reasoned, `window/knip.jsonc: add a // reason above ${text}`);
      continue;
    }
    if (text === '' || /^[\]}],?$/.test(text)) reasoned = false;
  }
});
