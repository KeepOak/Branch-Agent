// node --test scripts/check-openclaw-wording.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWLIST,
  REPLACEMENTS,
  allowlistRule,
  checkAddedDiff,
  findCandidateSpans,
  formatFailure,
  parseAddedLines,
} from './check-openclaw-wording.mjs';

function diff(file, hunks) {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks,
  ].join('\n');
}

function added(file, line, text) {
  return diff(file, [`@@ -${Math.max(line - 1, 0)},0 +${line},1 @@`, `+${text}`]);
}

test('added user-visible OpenClaw wording fails', () => {
  const hits = checkAddedDiff(added('engine/src/wizard/setup.ts', 12, 'Welcome to OpenClaw'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'engine/src/wizard/setup.ts');
  assert.equal(hits[0].line, 12);
  assert.equal(hits[0].kind, 'name');
  assert.match(hits[0].match, /OpenClaw/);
});

test('added docs and GitHub links fail', () => {
  const docs = checkAddedDiff(added(
    'engine/src/agents/system-prompt.ts',
    609,
    'Docs: https://docs.openclaw.ai',
  ));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'host');
  assert.match(docs[0].match, /docs\.openclaw\.ai/);

  const github = checkAddedDiff(added(
    'engine/src/agents/system-prompt.ts',
    611,
    'Source: https://github.com/openclaw/openclaw',
  ));
  assert.equal(github.length, 1);
  assert.equal(github[0].kind, 'github');
  assert.match(github[0].match, /github\.com\/openclaw/);
});

test('removed OpenClaw wording passes', () => {
  const text = diff('engine/src/wizard/setup.ts', [
    '@@ -12,1 +12,0 @@',
    '-Welcome to OpenClaw',
  ]);
  assert.deepEqual(parseAddedLines(text), []);
  assert.deepEqual(checkAddedDiff(text), []);
});

test('replacing OpenClaw with Branch Agent passes', () => {
  const text = diff('engine/src/wizard/setup.ts', [
    '@@ -12,1 +12,1 @@',
    '-Welcome to OpenClaw',
    '+Welcome to Branch Agent',
  ]);
  assert.deepEqual(checkAddedDiff(text), []);
});

test('allowlisted internals pass', () => {
  const cases = [
    ['engine/src/compat.ts', 'import x from "@openclaw/crabline"'],
    ['engine/src/compat.ts', 'const home = process.env.OPENCLAW_HOME;'],
    ['engine/src/compat.ts', 'readConfig("openclaw.json")'],
    ['engine/src/compat.ts', '{ "openclaw": { "legacy": true } }'],
    ['engine/src/compat.ts', 'from "legacy/openclaw/compat"'],
    ['engine/extensions/whatsapp/skills/wacli/SKILL.md', '"module": "github.com/openclaw/wacli/cmd/wacli@latest"'],
    ['docs/notes.md', 'Copied from openclaw/openclaw@abc123def4567890'],
    ['engine/LICENSE', '© 2026 OpenClaw Foundation — MIT License.'],
    ['engine/src/foo.test.ts', 'expect(url).toBe("https://docs.openclaw.ai")'],
    ['engine/package.json', '"repository": "https://github.com/openclaw/openclaw"'],
  ];
  for (const [file, line] of cases) {
    assert.deepEqual(checkAddedDiff(added(file, 3, line)), [], `${file}: ${line}`);
  }
});

test('upstream image refs pass and docs.openclaw.ai still fails', () => {
  assert.deepEqual(checkAddedDiff(added(
    'engine/src/cli/fleet-cli/register.ts',
    64,
    '.option("--image <ref>", "Container image", "ghcr.io/openclaw/openclaw:1.2.3")',
  )), []);
  assert.deepEqual(checkAddedDiff(added(
    'engine/docs/help/testing/qa-runners.md',
    31,
    '`ghcr.io/openclaw/openclaw-live-media-runner:ubuntu-24.04`',
  )), []);
  assert.deepEqual(checkAddedDiff(added(
    'engine/docs/install/docker.md',
    47,
    'Use `ghcr.io/openclaw/openclaw` or `openclaw/openclaw` and avoid unofficial mirrors.',
  )), []);
  assert.deepEqual(checkAddedDiff(added(
    'engine/docs/install/docker.md',
    48,
    'images: ["ghcr.io/openclaw/openclaw", "docker.io/openclaw/openclaw"]',
  )), []);
  const docs = checkAddedDiff(added(
    'engine/docs/install/docker.md',
    49,
    'See https://docs.openclaw.ai/install/docker',
  ));
  assert.equal(docs.length, 1);
  assert.equal(docs[0].kind, 'host');
  assert.match(docs[0].match, /docs\.openclaw\.ai/);
});

test('go.mod module paths without a version pass', () => {
  assert.deepEqual(checkAddedDiff(added(
    'engine/scripts/docs-i18n/go.mod',
    1,
    'module github.com/openclaw/openclaw/scripts/docs-i18n',
  )), []);
  const other = checkAddedDiff(added(
    'engine/src/compat.ts',
    1,
    'module github.com/openclaw/openclaw/scripts/docs-i18n',
  ));
  assert.equal(other.length, 1);
  assert.equal(other[0].kind, 'github');
});

test('rewrapping upstream OpenClaw attribution in contributor docs passes', () => {
  assert.deepEqual(checkAddedDiff(added(
    'CONTRIBUTING.md',
    18,
    'The engine follows upstream OpenClaw.',
  )), []);
  assert.deepEqual(checkAddedDiff(added(
    'AGENTS.md',
    17,
    'If upstream OpenClaw or an established open-source project already does it, copy that code.',
  )), []);
  const fresh = checkAddedDiff(added('CONTRIBUTING.md', 20, 'Welcome to OpenClaw'));
  assert.equal(fresh.length, 1);
  const ui = checkAddedDiff(added('engine/src/wizard/setup.ts', 4, 'The engine follows upstream OpenClaw.'));
  assert.equal(ui.length, 1);
});

test('the window cleanliness check may name OpenClaw so it can catch leftovers', () => {
  assert.deepEqual(checkAddedDiff(added(
    'scripts/check-window-clean.mjs',
    4,
    'OpenClaw and openclaw in window copy',
  )), []);
  assert.deepEqual(checkAddedDiff(added(
    'scripts/window-clean-baseline.txt',
    2,
    'product-name\twindow/src/a.tsx\tWelcome to OpenClaw',
  )), []);
  const leaked = checkAddedDiff(added('window/src/a.tsx', 2, 'Welcome to OpenClaw'));
  assert.equal(leaked.length, 1);
});

test('allowlist is explicit: every rule has an id and a why', () => {
  assert.ok(ALLOWLIST.length >= 8);
  for (const rule of ALLOWLIST) {
    assert.equal(typeof rule.id, 'string');
    assert.ok(rule.id.length > 0);
    assert.equal(typeof rule.why, 'string');
    assert.ok(rule.why.length > 0);
    assert.ok(rule.file || rule.line || rule.re, rule.id);
  }
});

test('the recheck workflow name line is allowlisted; the same words anywhere else still fail', () => {
  const workflow = '.github/workflows/merge-gate-recheck.yml';
  assert.deepEqual(checkAddedDiff(added(workflow, 30, '      - OpenClaw wording')), []);
  // The allowance covers the name line only, not other text in the same workflow...
  assert.equal(checkAddedDiff(added(workflow, 31, 'echo "Welcome to OpenClaw"')).length, 1);
  // ...and not the same name line in any other file.
  assert.equal(checkAddedDiff(added('.github/workflows/other.yml', 30, '      - OpenClaw wording')).length, 1);
});

test('failure message tells the agent what to write instead', () => {
  const hits = checkAddedDiff(added('engine/src/prompts.ts', 4, 'Read https://docs.openclaw.ai/gateway'));
  const message = formatFailure(hits);
  assert.match(message, /Branch Agent/);
  assert.match(message, /https:\/\/keepoak\.com\/help/);
  assert.match(message, /https:\/\/keepoak\.com/);
  assert.match(message, /https:\/\/github\.com\/KeepOak\/Branch-Agent/);
  assert.match(message, /engine\/src\/prompts\.ts:4:/);
  for (const row of REPLACEMENTS) assert.match(message, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('parseAddedLines records only plus lines and their new-file numbers', () => {
  const text = [
    'diff --git a/engine/src/a.ts b/engine/src/a.ts',
    '--- a/engine/src/a.ts',
    '+++ b/engine/src/a.ts',
    '@@ -10,2 +10,3 @@',
    ' context',
    '-gone OpenClaw',
    '+Branch Agent',
    '+extra',
  ].join('\n');
  assert.deepEqual(parseAddedLines(text), [
    { file: 'engine/src/a.ts', line: 11, text: 'Branch Agent' },
    { file: 'engine/src/a.ts', line: 12, text: 'extra' },
  ]);
});

test('a +++ line inside a hunk is added content, not a file header', () => {
  const text = [
    'diff --git a/engine/src/a.ts b/engine/src/a.ts',
    '--- a/engine/src/a.ts',
    '+++ b/engine/src/a.ts',
    '@@ -10,0 +11,2 @@',
    '+++ b/window/src/app.tsx',
    '+Welcome to OpenClaw',
  ].join('\n');
  assert.deepEqual(parseAddedLines(text), [
    { file: 'engine/src/a.ts', line: 11, text: '++ b/window/src/app.tsx' },
    { file: 'engine/src/a.ts', line: 12, text: 'Welcome to OpenClaw' },
  ]);
  const hits = checkAddedDiff(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, 'engine/src/a.ts');
  assert.equal(hits[0].line, 12);
});

test('host spans win over the product-name span inside the same URL', () => {
  const spans = findCandidateSpans('See https://docs.openclaw.ai/help');
  assert.deepEqual(spans.map((span) => span.kind), ['host']);
});

test('standalone OPENCLAW in a string is a name hit; OPENCLAW_HOME is not', () => {
  assert.equal(findCandidateSpans('label: "OPENCLAW"').length, 1);
  assert.deepEqual(findCandidateSpans('process.env.OPENCLAW_HOME'), []);
});

test('allowlistRule covers an npm scope and rejects the same word in prose', () => {
  const pkg = findCandidateSpans('dep @openclaw/crabline')[0];
  assert.equal(allowlistRule('engine/src/a.ts', 'dep @openclaw/crabline', pkg)?.id, 'npm-scope');
  const prose = findCandidateSpans('Welcome to OpenClaw')[0];
  assert.equal(allowlistRule('engine/src/a.ts', 'Welcome to OpenClaw', prose), null);
});
