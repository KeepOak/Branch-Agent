#!/usr/bin/env node
// Fail when Branch source, by default, reads a paid provider API key or calls a
// paid embeddings endpoint. Subscription sign-ins are the default; paid keys and
// paid embeddings must be an explicit user setting. Memory search must default
// to keyword-only (none), not openai/gemini/voyage.
//
// Run:
//   node scripts/check-no-paid-defaults.mjs
//   node --test scripts/check-no-paid-defaults.test.mjs
//
// Opt-in hits (behind an explicit user setting) live in
// scripts/check-no-paid-defaults-allowlist.txt. A known default that this check
// does not change is listed there with TODO in the reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const allowlistPath = 'scripts/check-no-paid-defaults-allowlist.txt';
export const SCAN_DIRS = ['engine', 'desktop', 'window'];
export const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts']);
export const KINDS = ['paid-key', 'embeddings-endpoint', 'embeddings-default'];

export const PAID_KEY_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'VOYAGE_API_KEY',
  'COHERE_API_KEY',
  'MISTRAL_API_KEY',
];

export const PAID_EMBEDDING_PROVIDERS = ['openai', 'gemini', 'voyage', 'cohere', 'mistral'];

const KEY_ALT = PAID_KEY_ENV_VARS.join('|');
const PROVIDER_ALT = PAID_EMBEDDING_PROVIDERS.join('|');

const SKIP_DIR = /(?:^|\/)(?:node_modules|dist|build|coverage|generated|docs|examples|fixtures|__fixtures__|testdata|test-helpers|test-support|__tests__)(?:\/|$)/;
const TEST_FILE = /\.(?:test|spec|fixture)(?:-support|-helpers)?\.[cm]?[jt]sx?$|\.live\.test\.|\.e2e\.test\.|\.native-tests\.|\.d\.ts$/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;
const DELETE_ENV = /^\s*delete\s+process\.env\b/;
const ASSIGN_ENV_RE = new RegExp(
  String.raw`process\.env(?:\s*\.\s*(?:${KEY_ALT})|\s*\[\s*["'\`](?:${KEY_ALT})["'\`]\s*\])\s*=(?!=)`,
);

const PAID_KEY_RE = new RegExp(
  String.raw`(?:process\.env(?:\s*\.\s*(?:${KEY_ALT})|\s*\[\s*["'\`](?:${KEY_ALT})["'\`]\s*\])|(?<![\w."'\`])env\s*\.\s*(?:${KEY_ALT}))`,
);
const EMBEDDINGS_ENDPOINT_RE = /\/v1\/embeddings|:embedContent\b|api\.voyageai\.com/i;
const DEFAULT_PROVIDER_CONST_RE = new RegExp(
  String.raw`DEFAULT_[A-Z0-9_]*(?:EMBEDDING|MEMORY|SEARCH)[A-Z0-9_]*PROVIDER[A-Z0-9_]*\s*=\s*["'](?:${PROVIDER_ALT})["']`,
);
const EMBEDDING_PROVIDER_FALLBACK_RE = new RegExp(
  String.raw`embedding(?:s)?\.provider\b[^;\n]{0,160}\?[^;\n]{0,80}:\s*["'](?:${PROVIDER_ALT})["']`,
);
const MEMORY_SEARCH_PROVIDER_RE = new RegExp(
  String.raw`memory\.search\.provider\b[^;\n]{0,120}(?:\|\||\?\?|def\s*:|default\s*:)\s*["'](?:${PROVIDER_ALT})["']`,
);

function paidProviderIn(match) {
  const text = String(match ?? '');
  return PAID_EMBEDDING_PROVIDERS.find((name) => text.includes(`"${name}"`) || text.includes(`'${name}'`)) ?? 'openai';
}

export function isScannedPath(rel) {
  const file = String(rel ?? '').replaceAll('\\', '/');
  if (!file || file.startsWith('mobile/')) return false;
  if (!SCAN_DIRS.some((dir) => file === dir || file.startsWith(`${dir}/`))) return false;
  if (file.startsWith('engine/test/')) return false;
  if (SKIP_DIR.test(file) || TEST_FILE.test(file)) return false;
  return SOURCE_EXTS.has(path.extname(file));
}

function skipLine(line) {
  return COMMENT_LINE.test(line) || DELETE_ENV.test(line) || ASSIGN_ENV_RE.test(line);
}

function pushHit(hits, { kind, file, line, match, detail }) {
  hits.push({
    kind,
    file,
    line,
    match: String(match).trim().slice(0, 200),
    detail,
  });
}

export function scanText(file, text) {
  const hits = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (skipLine(line)) continue;
    const lineNumber = index + 1;
    const keyMatch = PAID_KEY_RE.exec(line);
    if (keyMatch) {
      pushHit(hits, {
        kind: 'paid-key',
        file,
        line: lineNumber,
        match: keyMatch[0],
        detail: 'paid API key read',
      });
    }
    const endpointMatch = EMBEDDINGS_ENDPOINT_RE.exec(line);
    if (endpointMatch) {
      pushHit(hits, {
        kind: 'embeddings-endpoint',
        file,
        line: lineNumber,
        match: endpointMatch[0],
        detail: 'paid embeddings endpoint',
      });
    }
    const defaultMatch = DEFAULT_PROVIDER_CONST_RE.exec(line)
      ?? EMBEDDING_PROVIDER_FALLBACK_RE.exec(line)
      ?? MEMORY_SEARCH_PROVIDER_RE.exec(line);
    if (defaultMatch) {
      pushHit(hits, {
        kind: 'embeddings-default',
        file,
        line: lineNumber,
        match: defaultMatch[0],
        detail: `default embeddings provider ${paidProviderIn(defaultMatch[0])}`,
      });
    }
  }
  return hits;
}

function walkDir(dir, cwd, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(cwd, full).replaceAll('\\', '/');
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIR.test(`${rel}/`)) continue;
      walkDir(full, cwd, out);
      continue;
    }
    if (isScannedPath(rel)) out.push(rel);
  }
}

export function listSourceFiles(cwd = root) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(cwd, dir);
    try {
      if (statSync(full).isDirectory()) walkDir(full, cwd, files);
    } catch {
      // missing tree in a fixture
    }
  }
  return [...new Set(files)].sort();
}

export function scanTree(cwd = root) {
  const findings = [];
  for (const file of listSourceFiles(cwd)) {
    findings.push(...scanText(file, readFileSync(path.join(cwd, file), 'utf8')));
  }
  return findings;
}

export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const parts = raw.split('\t');
    if (parts.length < 3) {
      errors.push(`allowlist line ${index + 1} must be path, kind, and reason (tab-separated)`);
      continue;
    }
    const filePath = parts[0].trim();
    const kind = parts[1].trim();
    const reason = parts.slice(2).join('\t').trim();
    if (!filePath) {
      errors.push(`allowlist line ${index + 1} is missing a path`);
      continue;
    }
    if (kind !== '*' && !KINDS.includes(kind)) {
      errors.push(`allowlist line ${index + 1} kind must be ${KINDS.join(', ')}, or *`);
      continue;
    }
    if (!reason) {
      errors.push(`allowlist line ${index + 1} must say why this hit is opt-in`);
      continue;
    }
    entries.push({ path: filePath, kind, reason, line: index + 1 });
  }
  return { entries, errors };
}

export function allowlistMatches(entry, file, kind) {
  if (entry.kind !== '*' && entry.kind !== kind) return false;
  if (entry.path.endsWith('/')) return file.startsWith(entry.path);
  return file === entry.path;
}

export function applyAllowlist(findings, entries) {
  const remaining = [];
  const allowed = [];
  for (const finding of findings) {
    const entry = entries.find((item) => allowlistMatches(item, finding.file, finding.kind));
    if (entry) allowed.push({ ...finding, reason: entry.reason });
    else remaining.push(finding);
  }
  const stale = entries.filter((entry) =>
    !findings.some((finding) => allowlistMatches(entry, finding.file, finding.kind)));
  return { remaining, allowed, stale };
}

export function findingKey(finding) {
  return `${finding.kind}\t${finding.file}:${finding.line}\t${finding.match}`;
}

const FIX_ADVICE = {
  'paid-key': 'Do not read a paid provider API key on a default path. Use a ChatGPT or Claude subscription sign-in, or put the read behind an explicit user setting and allowlist it with the reason.',
  'embeddings-endpoint': 'Do not call a paid embeddings API on a default path. Memory search must stay keyword-only unless the user turned embeddings on.',
  'embeddings-default': 'Memory search must default to none/keyword, not a paid embeddings provider (openai, gemini, voyage, cohere, mistral).',
};

export function formatReport({ remaining, stale, allowed, parseErrors }) {
  const lines = [];
  for (const error of parseErrors ?? []) lines.push(error);
  if (remaining.length) {
    lines.push('Default-on paid provider key or embeddings use. Do not add an allowlist line unless the path is genuinely opt-in.');
    lines.push('');
    for (const finding of remaining) {
      lines.push(`${finding.kind}  ${finding.file}:${finding.line}`);
      lines.push(`  ${finding.match}`);
      lines.push(`  Fix: ${FIX_ADVICE[finding.kind] ?? 'Remove the default paid path.'}`);
      lines.push('');
    }
  }
  if (stale.length) {
    lines.push('stale allowlist entry, delete it');
    for (const entry of stale) {
      lines.push(`stale allowlist entry, delete it: ${entry.path}  ${entry.kind}`);
    }
    lines.push('');
  }
  lines.push(`Allowlisted opt-in hits: ${allowed.length} (pass)`);
  if (!remaining.length && !stale.length && !(parseErrors ?? []).length) {
    lines.push('Paid-defaults check: no default-on paid keys or embeddings.');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

export function checkNoPaidDefaults({ findings, allowlistText }) {
  const parsed = parseAllowlist(allowlistText);
  const applied = applyAllowlist(findings, parsed.entries);
  const text = formatReport({ ...applied, parseErrors: parsed.errors });
  return {
    ...applied,
    parseErrors: parsed.errors,
    text,
    ok: applied.remaining.length === 0 && applied.stale.length === 0 && parsed.errors.length === 0,
  };
}

function runCli() {
  const started = Date.now();
  const findings = scanTree(root);
  const result = checkNoPaidDefaults({
    findings,
    allowlistText: readFileSync(path.join(root, allowlistPath), 'utf8'),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  if (!result.ok) {
    console.error(result.text);
    console.error(`Paid-defaults check failed in ${elapsed}s.`);
    process.exitCode = 1;
    return;
  }
  console.log(result.text.trimEnd());
  console.log(`Paid-defaults check finished in ${elapsed}s.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
