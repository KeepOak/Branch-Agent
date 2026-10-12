// Fail a PR that adds user-visible OpenClaw wording or upstream docs/GitHub links.
// Only added lines are scanned, so removing leftover copy always passes and cleanup
// PRs do not edit a shared baseline. Internals that cannot be renamed yet must match
// an explicit ALLOWLIST entry below.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REPLACEMENTS = [
  'OpenClaw / openclaw     → Branch Agent (product) or branch (CLI)',
  'docs.openclaw.ai        → https://keepoak.com/help',
  'openclaw.ai             → https://keepoak.com',
  'github.com/openclaw/... → https://github.com/KeepOak/Branch-Agent',
];

// Each rule is opt-in and documented. A hit is allowed only when every listed
// constraint matches. `file` limits the path, `line` the whole added line, and
// `re` the span that contains the OpenClaw text. Do not add directory-wide
// skips for docs, comments, or source trees.
export const ALLOWLIST = [
  {
    id: 'npm-scope',
    why: 'Upstream npm packages still publish under @openclaw and cannot be renamed yet',
    re: /@openclaw(?:\/|__|\+)[\w./+-]*/i,
  },
  {
    id: 'env-var',
    why: 'Compatibility environment variables (OPENCLAW_*) so old installs still start',
    re: /\bOPENCLAW_[A-Z0-9_]+\b/,
  },
  {
    id: 'config-key',
    why: 'Compatibility config keys and the old openclaw.json name so existing files still load',
    re: /(?:["']openclaw["']\s*:|\bopenclaw\.[A-Za-z0-9_.-]+|\bopenclaw\.json\b)/i,
  },
  {
    id: 'import-path',
    why: 'Import and require paths of packages that still use the old name',
    re: /(?:from\s+|import\s*\(|require\s*\()\s*["'`][^"'`]*openclaw[^"'`]*["'`]/i,
  },
  {
    id: 'go-module-spec',
    why: 'Go module install specs still live on github.com/openclaw/<module>@<version>',
    re: /(?<![/\w])github\.com\/openclaw\/[\w.-]+(?:\/[\w.-]+)*@[\w.-]+/,
  },
  {
    id: 'go-mod',
    why: 'go.mod module and require paths still use github.com/openclaw/... and have no version suffix',
    file: /(^|\/)go\.mod$/,
    re: /github\.com\/openclaw\/[\w./-]+/,
  },
  {
    id: 'image-ref',
    why: 'scripts/rebrand-map.json protect rule for image and repo names that must not be renamed: ghcr.io/openclaw/, docker.io/openclaw/, and the short openclaw/openclaw ref. Does not allow github.com/openclaw links.',
    re: /(?:ghcr\.io\/|docker\.io\/)openclaw\/[\w.-]+|(?<![\w.@/~-])openclaw\/openclaw(?![\w-])/i,
  },
  {
    id: 'upstream-attribution',
    why: 'Contributor docs name the fork origin; rewrapping "upstream OpenClaw" / "forked from OpenClaw" must not fail',
    file: /^(?:AGENTS|CONTRIBUTING|README)\.md$/,
    line: /upstream OpenClaw|forked from OpenClaw/i,
  },
  {
    id: 'upstream-pin',
    why: 'Pinned upstream citations (openclaw/openclaw@sha) used by the rename and harvest records',
    re: /\bopenclaw\/openclaw@[0-9a-f]{7,40}\b/i,
  },
  {
    id: 'upstream-issue',
    why: 'References to the upstream project\'s own issues and pull requests (openclaw#123)',
    re: /(?<![^\s])openclaw(?:\/openclaw)?#\d+/i,
  },
  {
    id: 'license-notice',
    why: 'Copyright and licence notices stay as the upstream wrote them',
    line: /(?:Copyright|©|SPDX-License-Identifier|Licensed under|OpenClaw Foundation)/i,
  },
  {
    id: 'test-fixture',
    why: 'Test fixtures may still mention leftover OpenClaw copy until cleanup PRs remove it',
    file: /(^|\/)(?:fixtures|__fixtures__|test-helpers|test-support|testdata)\/|\.(?:test|spec|fixture)\.(?:[cm]?[jt]sx?|mjs|mts)$/i,
  },
  {
    id: 'this-check',
    why: 'This check, its tests, and the workflow must name OpenClaw to describe what they block',
    file: /^(?:scripts\/check-openclaw-wording(?:\.test)?\.mjs|\.github\/workflows\/openclaw-wording-checks\.yml)$/,
  },
  {
    id: 'recheck-workflow-name',
    why: 'merge-gate-recheck lists the OpenClaw wording workflow by its name in its workflow_run trigger. Workflow names are internal and the required-check names depend on them, so this one name line stays',
    file: /^\.github\/workflows\/merge-gate-recheck\.yml$/,
    line: /^\s*-\s+OpenClaw wording\s*$/,
  },
  {
    id: 'window-clean-check',
    why: 'The window cleanliness check and its baseline name old product words so leftover window copy can be found and shrunk',
    file: /^scripts\/(?:check-window-clean\.mjs|window-clean-baseline\.txt)$/,
  },
  {
    id: 'rulebook',
    why: 'AGENTS.md documents that this check blocks new OpenClaw wording',
    file: /^AGENTS\.md$/,
    line: /check-openclaw-wording/,
  },
  {
    id: 'package-metadata',
    why: 'package.json and lockfiles still record upstream package names and repository URLs',
    file: /(^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json)$/,
  },
  {
    id: 'copied-csv',
    why: 'Harvest provenance rows name the upstream project as openclaw/openclaw',
    file: /^docs\/upstream\/COPIED\.csv$/,
  },
  {
    id: 'display-name-map',
    why: 'single display-name map; engine keys only, never rendered',
    file: /^window\/src\/display-names\.ts$/,
    re: /\["openclaw", "Branch"\]/,
  },
  {
    id: 'about-credit',
    why: 'the one "Based on OpenClaw" credit line in Settings > Updates & about (owner decision: one credit line)',
    file: /^window\/src\/places\/settings\/set2\/updates\.tsx$/,
    re: /Based on OpenClaw/,
  },
  {
    id: 'rebrand-tooling',
    why: 'The rename map and script must keep the old word so leftover names can still be found',
    file: /^scripts\/rebrand(?:-map\.json|\.mjs)$/,
  },
];

const SKIP_PATH = /(?:^|\/)node_modules\/|(?:^|\/)\.git\//;

const HOST_RE = /(?:(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)*)openclaw\.ai\b(?:\/[^\s"'`)<>]*)?/gi;
const GITHUB_RE = /(?:https?:\/\/)?github\.com\/openclaw(?:\/[^\s"'`)<>]*)?/gi;
const PRODUCT_RE = /\bopen[\s_-]?claw\b/gi;

export function parseAddedLines(diff) {
  const added = [];
  let file = null;
  let newLine = 0;
  let inHunk = false;
  let oldLeft = 0;
  let newLeft = 0;
  let expectPlusHeader = false;

  const endHunkIfDone = () => {
    if (inHunk && oldLeft <= 0 && newLeft <= 0) inHunk = false;
  };

  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('diff ')) {
      file = null;
      inHunk = false;
      expectPlusHeader = false;
      continue;
    }
    if (!inHunk && /^--- (?:a\/|\/dev\/null|")/.test(raw)) {
      expectPlusHeader = true;
      continue;
    }
    if (!inHunk && expectPlusHeader && raw.startsWith('+++ ')) {
      const plusFile = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw);
      file = !plusFile || plusFile[1] === '/dev/null' ? null : stripDiffQuotes(plusFile[1]);
      expectPlusHeader = false;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      expectPlusHeader = false;
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLine = Number(hunk[3]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      inHunk = oldLeft > 0 || newLeft > 0;
      continue;
    }
    if (!inHunk) {
      expectPlusHeader = false;
      continue;
    }
    if (raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) {
      if (file && !SKIP_PATH.test(file)) {
        added.push({ file, line: newLine, text: raw.slice(1) });
      }
      newLine += 1;
      newLeft -= 1;
      endHunkIfDone();
      continue;
    }
    if (raw.startsWith('-')) {
      oldLeft -= 1;
      endHunkIfDone();
      continue;
    }
    newLine += 1;
    newLeft -= 1;
    oldLeft -= 1;
    endHunkIfDone();
  }
  return added;
}

function stripDiffQuotes(file) {
  if (file.length >= 2 && file.startsWith('"') && file.endsWith('"')) {
    return file.slice(1, -1).replace(/\\([\\ntr"])/g, (_, ch) => ({ '\\': '\\', n: '\n', t: '\t', r: '\r', '"': '"' }[ch]));
  }
  return file;
}

function spansFrom(text, regex) {
  const spans = [];
  const global = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  let match;
  while ((match = global.exec(text))) {
    spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return spans;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

export function findCandidateSpans(text) {
  const preferred = [
    ...spansFrom(text, HOST_RE).map((span) => ({ ...span, kind: 'host' })),
    ...spansFrom(text, GITHUB_RE).map((span) => ({ ...span, kind: 'github' })),
  ];
  const names = spansFrom(text, PRODUCT_RE)
    .filter((span) => !preferred.some((other) => overlaps(span, other)))
    .map((span) => ({ ...span, kind: 'name' }));
  return [...preferred, ...names];
}

function coveredBy(text, span, regex) {
  return spansFrom(text, regex).some((other) => span.start >= other.start && span.end <= other.end);
}

export function allowlistRule(file, text, span) {
  for (const rule of ALLOWLIST) {
    if (rule.file && !rule.file.test(file)) continue;
    if (rule.line && !rule.line.test(text)) continue;
    if (rule.re && !coveredBy(text, span, rule.re)) continue;
    if (!rule.file && !rule.line && !rule.re) continue;
    return rule;
  }
  return null;
}

export function findHits(addedLines) {
  const hits = [];
  for (const { file, line, text } of addedLines) {
    for (const span of findCandidateSpans(text)) {
      if (allowlistRule(file, text, span)) continue;
      hits.push({ file, line, text, match: span.text, kind: span.kind });
    }
  }
  return hits;
}

export function formatFailure(hits) {
  const lines = [
    'New user-visible OpenClaw wording is blocked so the rebrand to Branch Agent only moves forward.',
    '',
    'Replace it with Branch Agent naming and Branch links:',
    ...REPLACEMENTS.map((row) => `  ${row}`),
    '',
    'Do not add a baseline file. Remove leftover wording, or keep only an allowlisted internal',
    '(package names, import paths, compatibility config keys and env vars, license notices,',
    'test fixtures, upstream image refs). See ALLOWLIST in scripts/check-openclaw-wording.mjs.',
    '',
    'Hits:',
  ];
  for (const hit of hits) {
    lines.push(`  ${hit.file}:${hit.line}: ${hit.text.trim()}`);
  }
  return lines.join('\n');
}

export function checkAddedDiff(diff) {
  return findHits(parseAddedLines(diff));
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
}

export function wordingDiff(cwd = root, base = process.env.OPENCLAW_WORDING_BASE || 'HEAD^1') {
  return { base, diff: git(['diff', '--no-color', '--no-ext-diff', '--unified=0', `${base}...HEAD`], cwd) };
}

export function reportWordingCheck(cwd = root, base = process.env.OPENCLAW_WORDING_BASE || 'HEAD^1') {
  const { diff } = wordingDiff(cwd, base);
  const hits = checkAddedDiff(diff);
  return { hits, base };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { hits, base } = reportWordingCheck();
  if (hits.length) {
    console.error(formatFailure(hits));
    process.exitCode = 1;
  } else {
    console.log(`OpenClaw wording: no new user-visible hits against ${base}.`);
  }
}
