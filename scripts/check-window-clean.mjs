// Window cleanliness check.
//
// Stops new leftover product names, raw theme values, and stub UI from landing
// in the desktop window. Existing hits are recorded in
// scripts/window-clean-baseline.txt and pass. New hits fail. A baseline line
// that the scan no longer finds fails with "stale baseline entry, delete it",
// so the list only shrinks.
//
// Run:
//   node scripts/check-window-clean.mjs
//   node --test scripts/check-window-clean.test.mjs
//
// What it scans:
//   window/src/**/*.{ts,tsx,css,html} and window/index.html.
//   Tests, declaration files, and generated asset bundles are skipped: they
//   are not the screen a person uses.
//
// Baseline:
//   One finding per line: category <TAB> repo-relative path <TAB> normalized
//   snippet. Snippets are the source line (or a short window on a very long
//   line), with whitespace collapsed. There are no line numbers, so an edit
//   on another line does not churn the file. Duplicate snippets are repeated
//   once per occurrence. Lines starting with # are comments.
//   Fix a baselined hit in the window, then delete the matching baseline line.
//   Do not add lines for new code. Rewrite the window instead.
//
// Categories:
//   product-name  User-visible OpenClaw, claw, Crabbox, crustacean, and the
//                 other non-tree product names in copy, labels, aria text,
//                 titles, placeholders, and toasts. Comments and identifiers
//                 do not count. Import paths that still have to keep an
//                 upstream package name are listed in IMPORT_ALLOWLIST.
//   theme         Raw #hex, rgb(), or hsl() colors, and font-family values
//                 that do not use the theme. The allowed home is
//                 window/src/theme/tokens.css, plus any CSS custom property
//                 definition (--token:) and font-family inside @font-face.
//   stale         Clear leftover markers: TODO-fallback, coming soon,
//                 not implemented, lorem ipsum, placeholder sprites, mock or
//                 demo data, toast-only click handlers, and functions or
//                 constants named *Fallback or *Legacy. Real settings UI for
//                 a model's backup list (FallbackLists and its pieces) is not
//                 a stub. Input placeholder attributes are real hints.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const baselinePath = 'scripts/window-clean-baseline.txt';

export const SCAN_DIRS = ['window/src'];
export const SCAN_FILES = ['window/index.html'];
export const SOURCE_EXTS = new Set(['.ts', '.tsx', '.css', '.html']);

// The Branch window theme. Raw colors and font stacks belong here.
export const THEME_TOKEN_FILES = new Set(['window/src/theme/tokens.css']);

// Real product UI, not a leftover shim. The settings pages call the model's
// backup list "Fallback".
export const STALE_NAME_EXCEPTIONS = new Set([
  'FallbackLists',
  'FallbackList',
  'TrunkFallbackNote',
  'Fallbacks',
]);

const PRODUCT_NAME_RE = /\b(?:open[\s_-]?claw|crustaceans?|crabboxes|crabbox|clawhub|crabline|lobsterdex|clawdbot|clawrouter|clawsweeper|clawpack|moltbot|moltbook|peekaboo|molty|clawdbots|clawds?|lobsters?|crabs?|claws?)\b/gi;

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])|\b(?:rgba?|hsla?)\s*\(/gi;

const WIDE_FONT_KEYWORD = /^(?:inherit|initial|unset|revert|revert-layer)$/i;

const USER_FACING_BEFORE = /(?:aria-label|aria-description|aria-placeholder|aria-valuetext|title|placeholder|alt|label|heading|hint|description|subtitle|caption|tooltip|content)\s*[:=]\s*\{?\s*$/i;
const TOAST_BEFORE = /(?:\btoast|\bonToast|\bshowToast|\bpushToast)\s*(?:\?\.)?\s*\(\s*$/;
const PROTOCOL_BEFORE = /(?:\b(?:id|source|key|path|slug|registry|packageName|kind|type|method|channel|backend)\s*[:=]\s*\{?\s*)$/;

const STALE_PHRASE_RE = /\b(?:TODO-fallback|coming soon|not implemented|lorem ipsum|placeholder sprites?)\b/gi;
const STALE_MOCK_RE = /\b(?:mockData|demoData|demoMode|isDemo|fakeData|dummyData)\b|\b(?:MOCK|DEMO)_[A-Z0-9_]+\b|\b(?:mock|demo)\s+(?:data|mode|only|implementation)\b/gi;
const STALE_COMMENT_RE = /\bLegacy\b|\blegacy (?:prop|layout|layouts|type|types|tile|tiles|name|path|api)\b|\bbackward-compat\b/gi;
const STALE_DECL_RE = /\b(?:export\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

// The single "Based on OpenClaw" credit line. Only this exact string in this exact file is allowed.
export const CREDIT_FILE = 'window/src/places/settings/set2/updates.tsx';
export const CREDIT_LINE = 'Based on OpenClaw';

// Import paths that still have to keep an upstream name. A hit is allowed
// only when the matched text sits in one of these. They are not drawn.
export const IMPORT_ALLOWLIST = [
  {
    id: 'openclaw-scope',
    why: 'Upstream npm packages still publish under @openclaw, so an import specifier may name that scope',
    allows(before, value) {
      return /@openclaw(?:\/[\w.-]+)?/.test(value)
        && /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*$/.test(before.slice(-48));
    },
  },
  {
    id: 'module-specifier',
    why: 'from / import() / require() specifiers are module ids, not window copy',
    allows(before) {
      return /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*$/.test(before.slice(-48));
    },
  },
];

export function isSkippedSource(rel) {
  const file = rel.replace(/\\/g, '/');
  if (file.includes('/generated/') || file.endsWith('.gen.ts') || file.endsWith('.d.ts')) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return true;
  return false;
}

export function isScannedPath(rel) {
  const file = rel.replace(/\\/g, '/');
  if (isSkippedSource(file)) return false;
  if (SCAN_FILES.includes(file)) return true;
  return SCAN_DIRS.some((dir) => file === dir || file.startsWith(`${dir}/`))
    && SOURCE_EXTS.has(path.extname(file));
}

export function normalizeSnippet(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

export function snippetAt(text, index, length) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  const lineEndIdx = text.indexOf('\n', index);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  // A short window around the hit, not the whole line. Several colors on one
  // line stay distinct, and an edit elsewhere on a long line does not move them.
  const start = Math.max(lineStart, index - 36);
  const end = Math.min(lineEnd, index + length + 36);
  return normalizeSnippet(text.slice(start, end));
}

export function findingKey(finding) {
  return `${finding.category}\t${finding.file}\t${finding.snippet}`;
}

function pushFinding(findings, finding) {
  const snippet = normalizeSnippet(finding.snippet);
  if (!snippet) return;
  findings.push({ ...finding, snippet });
}

function looksLikeJsxText(value) {
  const trimmed = value.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return false;
  if (/[;{}"`]/.test(trimmed) || trimmed.includes('=>')) return false;
  return true;
}

function isTagClose(text, index) {
  if (text[index] !== '>' || text[index + 1] === '=') return false;
  const prev = text[index - 1];
  if (!prev || prev === '=') return false;
  return /[A-Za-z0-9"'`/}]/.test(prev);
}

export function collectVisible(text) {
  const strings = [];
  const texts = [];
  const stack = [{ mode: 'code', expr: 0 }];
  let i = 0;
  let buf = '';
  let bufStart = 0;

  const finishString = (frame) => {
    strings.push({
      value: buf,
      index: bufStart,
      before: text.slice(Math.max(0, frame.start - 120), frame.start),
    });
    buf = '';
  };

  while (i < text.length) {
    const frame = stack[stack.length - 1];
    const ch = text[i];
    const next = text[i + 1];
    if (frame.mode === 'code') {
      if (frame.expr) {
        if (ch === '{') frame.expr += 1;
        else if (ch === '}') {
          frame.expr -= 1;
          if (frame.expr === 0) {
            stack.pop();
            buf = '';
            bufStart = i + 1;
            i += 1;
            continue;
          }
        }
      }
      if (ch === '/' && next === '/') {
        const end = text.indexOf('\n', i);
        i = end === -1 ? text.length : end + 1;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
        continue;
      }
      if (ch === '<' && text.startsWith('<!--', i)) {
        const end = text.indexOf('-->', i + 4);
        i = end === -1 ? text.length : end + 3;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        stack.push({ mode: 'str', q: ch, start: i });
        buf = '';
        bufStart = i + 1;
        i += 1;
        continue;
      }
      if (!frame.expr && isTagClose(text, i)) {
        const end = text.indexOf('<', i + 1);
        if (end !== -1) {
          const value = text.slice(i + 1, end);
          if (looksLikeJsxText(value)) texts.push({ value, index: i + 1 });
          i = end;
          continue;
        }
      }
      i += 1;
      continue;
    }
    if (ch === '\\') {
      buf += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (frame.q === '`' && ch === '$' && next === '{') {
      finishString(frame);
      stack.push({ mode: 'code', expr: 1 });
      i += 2;
      continue;
    }
    if (ch === frame.q) {
      finishString(frame);
      stack.pop();
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  return { strings, texts };
}

function allowlistedImport(before, value) {
  return IMPORT_ALLOWLIST.some((rule) => rule.allows(before, value));
}

function wholeStringIsName(value, match) {
  return value.trim().toLowerCase() === match.toLowerCase();
}

export function productNameFindings(file, text) {
  const findings = [];
  const { strings, texts } = collectVisible(text);
  const consider = (value, index, before) => {
    if (before !== undefined && allowlistedImport(before, value)) return;
    // The one credit line, in Settings > Updates & about (owner decision: one credit line).
    if (file === CREDIT_FILE && value === CREDIT_LINE) return;
    const flags = PRODUCT_NAME_RE.flags.includes('g') ? PRODUCT_NAME_RE.flags : `${PRODUCT_NAME_RE.flags}g`;
    const re = new RegExp(PRODUCT_NAME_RE.source, flags);
    let match;
    while ((match = re.exec(value))) {
      const hit = match[0];
      const prose = /\s/.test(value) || !wholeStringIsName(value, hit);
      const facing = before !== undefined && (USER_FACING_BEFORE.test(before.slice(-80)) || TOAST_BEFORE.test(before.slice(-80)));
      const protocol = before !== undefined && PROTOCOL_BEFORE.test(before.slice(-80)) && wholeStringIsName(value, hit);
      if (protocol && !facing) continue;
      if (!prose && !facing && before !== undefined) continue;
      pushFinding(findings, {
        category: 'product-name',
        file,
        snippet: snippetAt(text, index + match.index, hit.length),
        detail: hit,
      });
      if (hit.length === 0) re.lastIndex += 1;
    }
  };
  for (const item of strings) consider(item.value, item.index, item.before);
  for (const item of texts) consider(item.value, item.index, undefined);
  return findings;
}

export function isHardcodedFontFamily(value) {
  const family = String(value ?? '').trim();
  if (!family || /var\s*\(/i.test(family)) return false;
  const parts = family.split(',').map((part) => part.trim().replace(/^["']|["']$/g, ''));
  return parts.some((part) => part && !WIDE_FONT_KEYWORD.test(part));
}

export function fontShorthandFamily(value) {
  const trimmed = String(value ?? '').trim();
  if (WIDE_FONT_KEYWORD.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:^|\s)(?:\d*\.?\d+(?:px|rem|em|%|pt|vh|vw|ch|ex)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(?:\s*\/\s*[^\s,]+)?\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function skipCssString(text, index) {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

function skipCssBlock(text, openIndex) {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipCssString(text, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

function stripCssComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const next = end === -1 ? text.length : end + 2;
      out += ' '.repeat(next - i);
      i = next;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function directDeclarations(body) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      const end = skipCssString(body, i);
      out += body.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '{') {
      const semi = out.lastIndexOf(';');
      out = semi === -1 ? '' : out.slice(0, semi + 1);
      i = skipCssBlock(body, i);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function splitDeclarations(chunk) {
  const parts = [];
  let start = 0;
  let paren = 0;
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === '"' || ch === "'") {
      i = skipCssString(chunk, i);
      continue;
    }
    if (ch === '(') paren += 1;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === ';' && paren === 0) {
      parts.push(chunk.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  if (chunk.slice(start).trim()) parts.push(chunk.slice(start));
  return parts;
}

function colorHits(value) {
  const hits = [];
  const re = new RegExp(COLOR_RE.source, COLOR_RE.flags);
  let match;
  while ((match = re.exec(value))) {
    if (match[0].toLowerCase() === '#root') continue;
    hits.push(match);
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

function walkCssRules(css, visit) {
  const text = stripCssComments(css);
  const stack = [];
  let i = 0;
  let preludeStart = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipCssString(text, i);
      continue;
    }
    if (ch === '{') {
      const prelude = text.slice(preludeStart, i);
      stack.push({
        prelude,
        fontFace: /@font-face\b/i.test(prelude),
        bodyStart: i + 1,
      });
      preludeStart = i + 1;
      i += 1;
      continue;
    }
    if (ch === '}' && stack.length) {
      const frame = stack.pop();
      visit(frame, text.slice(frame.bodyStart, i), frame.bodyStart);
      preludeStart = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
}

function cssThemeFindings(file, text) {
  const findings = [];
  if (THEME_TOKEN_FILES.has(file)) return findings;
  walkCssRules(text, (frame, body, bodyStart) => {
    const inFontFace = frame.fontFace;
    for (const part of splitDeclarations(directDeclarations(body))) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const prop = part.slice(0, colon).trim().toLowerCase();
      const rawValue = part.slice(colon + 1);
      if (!prop || prop.startsWith('--') || prop.startsWith('@')) continue;
      const valueStart = bodyStart + body.indexOf(part) + colon + 1;
      if ((prop === 'font-family' || prop === 'font') && !(inFontFace && prop === 'font-family')) {
        const family = prop === 'font' ? fontShorthandFamily(rawValue) : rawValue;
        if (family && isHardcodedFontFamily(family)) {
          pushFinding(findings, {
            category: 'theme',
            file,
            snippet: snippetAt(text, Math.max(0, valueStart), family.length),
            detail: 'font',
          });
        }
      }
      for (const hit of colorHits(rawValue)) {
        pushFinding(findings, {
          category: 'theme',
          file,
          snippet: snippetAt(text, valueStart + hit.index, hit[0].length),
          detail: 'color',
        });
      }
    }
  });
  return findings;
}

function codeThemeFindings(file, text) {
  const findings = [];
  if (THEME_TOKEN_FILES.has(file) || file.endsWith('.css')) return findings;
  const { strings } = collectVisible(text);
  for (const item of strings) {
    const before = item.before.slice(-80);
    const fontKey = /(?:font-family|fontFamily)\s*[:=]\s*\{?\s*$/i.test(before);
    const fontShorthand = /(?:^|[^\w-])font\s*[:=]\s*\{?\s*$/i.test(before);
    if (fontKey && isHardcodedFontFamily(item.value)) {
      pushFinding(findings, {
        category: 'theme',
        file,
        snippet: snippetAt(text, item.index, item.value.length),
        detail: 'font',
      });
    } else if (fontShorthand) {
      const family = fontShorthandFamily(item.value);
      if (family && isHardcodedFontFamily(family)) {
        pushFinding(findings, {
          category: 'theme',
          file,
          snippet: snippetAt(text, item.index, item.value.length),
          detail: 'font',
        });
      }
    }
    for (const hit of colorHits(item.value)) {
      pushFinding(findings, {
        category: 'theme',
        file,
        snippet: snippetAt(text, item.index + hit.index, hit[0].length),
        detail: 'color',
      });
    }
  }
  return findings;
}

export function themeFindings(file, text) {
  if (file.endsWith('.css')) return cssThemeFindings(file, text);
  return codeThemeFindings(file, text);
}

function commentSpans(text) {
  const spans = [];
  const stack = [{ mode: 'code', expr: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = stack[stack.length - 1];
    const ch = text[i];
    const next = text[i + 1];
    if (frame.mode === 'code') {
      if (frame.expr) {
        if (ch === '{') frame.expr += 1;
        else if (ch === '}') {
          frame.expr -= 1;
          if (frame.expr === 0) {
            stack.pop();
            i += 1;
            continue;
          }
        }
      }
      if (ch === '/' && next === '/') {
        const end = text.indexOf('\n', i);
        const stop = end === -1 ? text.length : end;
        spans.push([i, stop]);
        i = stop;
        continue;
      }
      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        const stop = end === -1 ? text.length : end + 2;
        spans.push([i, stop]);
        i = stop;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        stack.push({ mode: 'str', q: ch, expr: 0 });
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (frame.q === '`' && ch === '$' && next === '{') {
      stack.push({ mode: 'code', expr: 1 });
      i += 2;
      continue;
    }
    if (ch === frame.q) {
      stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return spans;
}

function inSpan(spans, index) {
  return spans.some(([start, end]) => index >= start && index < end);
}

function phraseFindings(file, text, regex, spans, commentsOnly) {
  const findings = [];
  const seenLines = new Set();
  const re = new RegExp(regex.source, regex.flags);
  let match;
  while ((match = re.exec(text))) {
    const inside = inSpan(spans, match.index);
    if (commentsOnly && !inside) {
      if (match[0].length === 0) re.lastIndex += 1;
      continue;
    }
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    if (seenLines.has(lineStart)) {
      if (match[0].length === 0) re.lastIndex += 1;
      continue;
    }
    seenLines.add(lineStart);
    pushFinding(findings, {
      category: 'stale',
      file,
      snippet: snippetAt(text, match.index, match[0].length),
      detail: match[0],
    });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return findings;
}

export function isStaleDeclarationName(name) {
  if (!name || STALE_NAME_EXCEPTIONS.has(name)) return false;
  if (/^LEGACY_/.test(name) || /^legacy[A-Z0-9]/.test(name)) return true;
  return /(?:Fallback|Legacy)$/.test(name);
}

function declarationFindings(file, text) {
  const findings = [];
  const re = new RegExp(STALE_DECL_RE.source, STALE_DECL_RE.flags);
  let match;
  while ((match = re.exec(text))) {
    const name = match[1];
    if (!isStaleDeclarationName(name)) continue;
    pushFinding(findings, {
      category: 'stale',
      file,
      snippet: snippetAt(text, match.index, match[0].length),
      detail: name,
    });
  }
  return findings;
}

export function toastOnlyHandlers(text) {
  const hits = [];
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf('onClick', from);
    if (at === -1) break;
    let i = at + 'onClick'.length;
    while (text[i] === ' ' || text[i] === '\t') i += 1;
    if (text[i] !== '=') {
      from = at + 'onClick'.length;
      continue;
    }
    i += 1;
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i += 1;
    if (text[i] !== '{') {
      from = i;
      continue;
    }
    const end = skipCssBlock(text, i);
    const body = text.slice(i + 1, end - 1);
    if (isToastOnlyBody(body)) hits.push({ index: at, length: end - at, body });
    from = end;
  }
  return hits;
}

function isToastOnlyBody(body) {
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const calls = [...stripped.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\?\.)?\s*\(/g)].map((match) => match[1]);
  if (!calls.length) return false;
  const toastNames = new Set(['toast', 'onToast', 'showToast', 'pushToast']);
  return calls.every((name) => toastNames.has(name));
}

export function staleFindings(file, text) {
  const spans = commentSpans(text);
  const findings = [
    ...phraseFindings(file, text, STALE_PHRASE_RE, spans, false),
    ...phraseFindings(file, text, STALE_MOCK_RE, spans, false),
    ...phraseFindings(file, text, STALE_COMMENT_RE, spans, true),
    ...declarationFindings(file, text),
  ];
  for (const hit of toastOnlyHandlers(text)) {
    pushFinding(findings, {
      category: 'stale',
      file,
      snippet: snippetAt(text, hit.index, Math.min(hit.length, 120)),
      detail: 'toast-only',
    });
  }
  return findings;
}

export function scanText(file, text) {
  return [
    ...productNameFindings(file, text),
    ...themeFindings(file, text),
    ...staleFindings(file, text),
  ];
}

function walkDir(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'generated') continue;
      walkDir(full, out);
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
      if (statSync(full).isDirectory()) walkDir(full, files);
    } catch {
      // missing tree in a fixture
    }
  }
  for (const file of SCAN_FILES) {
    if (isScannedPath(file)) files.push(file);
  }
  return [...new Set(files)].sort();
}

export function scanTree(cwd = root) {
  const findings = [];
  for (const file of listSourceFiles(cwd)) {
    const text = readFileSync(path.join(cwd, file), 'utf8');
    findings.push(...scanText(file, text));
  }
  return findings;
}

export function parseBaseline(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) {
      throw new Error(`baseline line must be category, path, and snippet: ${line}`);
    }
    entries.push(`${parts[0]}\t${parts[1]}\t${parts.slice(2).join('\t')}`);
  }
  return entries;
}

export function formatBaseline(findings) {
  const lines = findings.map(findingKey).sort();
  return [
    '# Window cleanliness baseline. category, path, normalized snippet.',
    '# Do not add lines. Delete a line when that hit is gone from the window.',
    '# An edit on another line does not belong here: snippets have no line numbers.',
    ...lines,
    '',
  ].join('\n');
}

function multiset(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export function compareFindings(findings, baselineEntries) {
  const current = multiset(findings.map(findingKey));
  const baseline = multiset(baselineEntries);
  const fresh = [];
  const stale = [];
  const kept = [];
  for (const [key, count] of current) {
    const have = baseline.get(key) ?? 0;
    for (let i = 0; i < Math.min(count, have); i += 1) kept.push(key);
    for (let i = 0; i < count - have; i += 1) fresh.push(key);
  }
  for (const [key, count] of baseline) {
    const have = current.get(key) ?? 0;
    for (let i = 0; i < count - have; i += 1) stale.push(key);
  }
  fresh.sort();
  stale.sort();
  kept.sort();
  return { fresh, stale, kept };
}

const FIX_ADVICE = {
  'product-name': 'Replace the old product name in this user-visible text with Branch wording (Branch, Branch Agent, or the tree-themed name).',
  theme: 'Use a theme token from window/src/theme/tokens.css (var(--...)) instead of a raw color or font-family. Define a new token there if the palette does not have one yet.',
  stale: 'Remove the leftover fallback, placeholder, mock, or stub, or make the control do the real thing. A toast-only click is not an action.',
};

export function formatReport({ fresh, stale, kept }) {
  const lines = [];
  if (fresh.length) {
    lines.push('New window cleanliness violation. Fix the window source. Do not add a baseline line.');
    lines.push('');
    for (const key of fresh) {
      const [category, file, snippet] = key.split('\t');
      lines.push(`${category}  ${file}`);
      lines.push(`  ${snippet}`);
      lines.push(`  Fix: ${FIX_ADVICE[category] ?? 'Remove this leftover.'}`);
      lines.push('');
    }
  }
  if (stale.length) {
    lines.push('stale baseline entry, delete it');
    for (const key of stale) lines.push(`stale baseline entry, delete it: ${key.replace(/\t/g, '  ')}`);
    lines.push('');
  }
  const counts = { 'product-name': 0, theme: 0, stale: 0 };
  for (const key of kept) {
    const category = key.split('\t')[0];
    if (category in counts) counts[category] += 1;
  }
  lines.push(`Baselined product-name: ${counts['product-name']} (pass)`);
  lines.push(`Baselined theme: ${counts.theme} (pass)`);
  lines.push(`Baselined stale: ${counts.stale} (pass)`);
  lines.push(`Existing violations are listed in ${baselinePath} and pass.`);
  if (!fresh.length && !stale.length) lines.push('Window cleanliness: no new violations.');
  return { counts, text: lines.join('\n').replace(/\n+$/, '\n') };
}

export function checkWindowClean(findings, baselineText) {
  const result = compareFindings(findings, parseBaseline(baselineText));
  const report = formatReport(result);
  return { ...result, ...report, ok: result.fresh.length === 0 && result.stale.length === 0 };
}

function readBaseline(cwd) {
  return readFileSync(path.join(cwd, baselinePath), 'utf8');
}

function runCli() {
  const started = Date.now();
  const findings = scanTree(root);
  const result = checkWindowClean(findings, readBaseline(root));
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  if (!result.ok) {
    console.error(result.text);
    console.error(`Window cleanliness failed in ${elapsed}s.`);
    process.exitCode = 1;
    return;
  }
  console.log(result.text.trimEnd());
  console.log(`Window cleanliness finished in ${elapsed}s.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
