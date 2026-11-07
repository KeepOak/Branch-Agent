// node --test scripts/check-no-paid-defaults.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KINDS,
  PAID_KEY_ENV_VARS,
  allowlistPath,
  applyAllowlist,
  checkNoPaidDefaults,
  isScannedPath,
  parseAllowlist,
  scanText,
} from './check-no-paid-defaults.mjs';

test('a fixture that reads ANTHROPIC_API_KEY by default fails', () => {
  const hits = scanText(
    'engine/src/boot.ts',
    'export function start() {\n  const key = process.env.ANTHROPIC_API_KEY;\n  return key;\n}\n',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'paid-key');
  assert.equal(hits[0].file, 'engine/src/boot.ts');
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].match, /ANTHROPIC_API_KEY/);
  const result = checkNoPaidDefaults({ findings: hits, allowlistText: '' });
  assert.equal(result.ok, false);
  assert.equal(result.remaining.length, 1);
  assert.match(result.text, /paid-key/);
});

test('an allowlisted opt-in passes', () => {
  const findings = scanText(
    'engine/src/providers/anthropic.ts',
    'if (userEnabledAnthropic) {\n  return process.env.ANTHROPIC_API_KEY;\n}\n',
  );
  assert.equal(findings.length, 1);
  const allowlistText = [
    '# Opt-in uses.',
    'engine/src/providers/anthropic.ts\tpaid-key\tAnthropic plugin runs only when the user selects Anthropic',
    '',
  ].join('\n');
  const result = checkNoPaidDefaults({ findings, allowlistText });
  assert.equal(result.ok, true);
  assert.deepEqual(result.remaining, []);
  assert.equal(result.allowed.length, 1);
  assert.match(result.allowed[0].reason, /user selects Anthropic/);
});

test('a default embeddings provider of openai fails', () => {
  const hits = scanText(
    'engine/src/memory.ts',
    'const DEFAULT_MEMORY_EMBEDDING_PROVIDER = "openai";\n',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'embeddings-default');
  assert.match(hits[0].match, /openai/);
  const result = checkNoPaidDefaults({ findings: hits, allowlistText: '' });
  assert.equal(result.ok, false);
  assert.match(result.text, /embeddings-default/);
  assert.match(result.text, /keyword/);
});

test('tests, docs, and mobile are not scanned', () => {
  assert.equal(isScannedPath('engine/src/boot.ts'), true);
  assert.equal(isScannedPath('desktop/src/main.ts'), true);
  assert.equal(isScannedPath('window/src/app.tsx'), true);
  assert.equal(isScannedPath('engine/src/boot.test.ts'), false);
  assert.equal(isScannedPath('engine/src/boot.live.test.ts'), false);
  assert.equal(isScannedPath('engine/test/helpers/openai.ts'), false);
  assert.equal(isScannedPath('engine/docs/memory.md'), false);
  assert.equal(isScannedPath('engine/src/docs/note.ts'), false);
  assert.equal(isScannedPath('mobile/src/boot.ts'), false);
  assert.equal(isScannedPath('scripts/check-no-paid-defaults.mjs'), false);
});

test('a paid embeddings endpoint on a default path fails', () => {
  const hits = scanText(
    'engine/src/embed.ts',
    'await fetch("https://api.openai.com/v1/embeddings", { method: "POST" });\n',
  );
  assert.equal(hits.some((hit) => hit.kind === 'embeddings-endpoint'), true);
});

test('comments and env assignments are not reads', () => {
  const hits = scanText(
    'engine/src/boot.ts',
    [
      '// process.env.ANTHROPIC_API_KEY is documented here',
      'delete process.env.ANTHROPIC_API_KEY;',
      'process.env.OPENAI_API_KEY = "sk-fixture-not-a-real-key";',
      'console.log("set ANTHROPIC_API_KEY to enable Anthropic");',
      '',
    ].join('\n'),
  );
  assert.deepEqual(hits, []);
});

test('a typeof process.env paid-key check is a read', () => {
  const hits = scanText(
    'engine/src/speech.ts',
    'const ready = typeof process.env.GEMINI_API_KEY === "string";\n',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'paid-key');
});

test('a memory.search.provider UI default of openai fails', () => {
  const hits = scanText(
    'window/src/settings.tsx',
    '{ k: "memory.search.provider", kind: "pick", def: "openai" }\n',
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'embeddings-default');
});

test('an allowlist line without a reason fails', () => {
  const parsed = parseAllowlist('engine/src/boot.ts\tpaid-key\t\n');
  assert.ok(parsed.errors.some((error) => /must say why/.test(error)));
  const result = checkNoPaidDefaults({
    findings: scanText('engine/src/boot.ts', 'const key = process.env.ANTHROPIC_API_KEY;\n'),
    allowlistText: 'engine/src/boot.ts\tpaid-key\t',
  });
  assert.equal(result.ok, false);
});

test('a stale allowlist entry fails', () => {
  const findings = scanText('engine/src/boot.ts', 'export const ready = true;\n');
  const result = checkNoPaidDefaults({
    findings,
    allowlistText: 'engine/src/boot.ts\tpaid-key\twas opt-in, now unused\n',
  });
  assert.equal(result.ok, false);
  assert.equal(result.stale.length, 1);
  assert.match(result.text, /stale allowlist entry, delete it/);
});

test('directory allowlist prefixes apply only to the listed kind', () => {
  const findings = [
    ...scanText('engine/extensions/openai/speech.ts', 'const key = process.env.OPENAI_API_KEY;\n'),
    ...scanText('engine/extensions/openai/memory.ts', 'const DEFAULT_MEMORY_EMBEDDING_PROVIDER = "openai";\n'),
  ];
  const { remaining, allowed } = applyAllowlist(
    findings,
    parseAllowlist('engine/extensions/openai/\tpaid-key\tOpenAI plugin is user-selected\n').entries,
  );
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].kind, 'paid-key');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].kind, 'embeddings-default');
});

test('the paid-key list is the documented subscription-only providers', () => {
  assert.deepEqual(PAID_KEY_ENV_VARS, [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'VOYAGE_API_KEY',
    'COHERE_API_KEY',
    'MISTRAL_API_KEY',
  ]);
  assert.ok(KINDS.includes('paid-key'));
  assert.ok(KINDS.includes('embeddings-endpoint'));
  assert.ok(KINDS.includes('embeddings-default'));
});

test('merge-gate runs the paid-defaults check', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+run:\s*node --test scripts\/check-no-paid-defaults\.test\.mjs\s*$/m);
  assert.match(yaml, /^\s+run:\s*node scripts\/check-no-paid-defaults\.mjs\s*$/m);
});

test('every allowlist entry has a path, kind, and reason', () => {
  const parsed = parseAllowlist(readFileSync(new URL(`../${allowlistPath}`, import.meta.url), 'utf8'));
  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.entries.length >= 1);
  for (const entry of parsed.entries) {
    assert.equal(typeof entry.path, 'string');
    assert.ok(entry.path.length > 0);
    assert.ok(entry.kind === '*' || KINDS.includes(entry.kind));
    assert.ok(entry.reason.length > 8);
  }
});
