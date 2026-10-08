// Fail a pull request when its title, body, or added diff lines include
// personal machine details (absolute user-profile paths, emails, hostnames).
// The workflow reads the event payload and the GitHub Files API; it never
// checks out or executes pull-request code.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORKFLOW_PATH = '.github/workflows/personal-info-pr-scan.yml';
export const TRUSTED_CHECKOUT_REF = '${{ github.event.repository.default_branch }}';

// Added lines in these repo-relative paths are skipped. Keep the list small:
// only fixtures that must contain personal-looking samples (this matcher, plus
// ordinary test/fixture trees). Prefer placeholders such as <name> in new tests.
export const DIFF_PATH_ALLOWLIST = [
  'scripts/check-personal-info.test.mjs',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.mjs',
  '**/*.test.mts',
  '**/*.test.cjs',
  '**/fixtures/**',
  '**/test-helpers/**',
  '**/__fixtures__/**',
];

const SYSTEM_USERS = new Set([
  'public',
  'shared',
  'guest',
  'default',
  'default user',
  'all users',
  'runner',
  'you',
]);

const ALLOWED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'users.noreply.github.com',
  'noreply.github.com',
]);

const RESERVED_EMAIL_TLDS = new Set(['example', 'test', 'invalid']);

const WHATSAPP_JID_DOMAINS = new Set([
  's.whatsapp.net',
  'g.us',
  'c.us',
]);

const PLACEHOLDER_MDNS = new Set([
  'name',
  'user',
  'host',
  'hostname',
  'example',
]);

const CONTEXT_JOIN = String.raw`[\s:,'"-]+(?:(?:name|called|named)[\s:,'"-]+)?`;
const PC_NAME = String.raw`[A-Z][A-Za-z0-9]{0,20}_[A-Z][A-Za-z0-9]{0,20}`;
const CONTEXT_WORD = String.raw`[Mm]achines?|[Pp][Cc]s?|[Hh]osts?|[Cc]omputers?`;

// Stop the username at markdown and punctuation so `C:/Users/you` and
// C:/Users/<name>, stay placeholders. Real names such as alice still match.
const PATH_USER = String.raw`(?:<[^>\s/\\]+>|%[A-Za-z][A-Za-z0-9_]+%|\$[A-Za-z][A-Za-z0-9_]+|[A-Za-z0-9_-]+)`;
const WINDOWS_USER = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9])([A-Za-z]:[/\\]+Users[/\\]+)(${PATH_USER})`,
  'gi',
);
const MAC_USER = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9_:])(\/Users\/)(${PATH_USER})`,
  'g',
);
const LINUX_USER = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9_])(\/home\/)(${PATH_USER})`,
  'g',
);
const EMAIL = /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,})\b/g;
const MDNS = /\b([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)\.local\b/gi;
const WINDOWS_COMPUTER = /\b(DESKTOP|LAPTOP)-([A-Z0-9]{4,}|<[^>]+>)\b/g;
const PC_AFTER_CONTEXT = new RegExp(
  String.raw`\b(${CONTEXT_WORD})\b${CONTEXT_JOIN}\b(${PC_NAME})\b`,
  'g',
);
const PC_BEFORE_CONTEXT = new RegExp(
  String.raw`\b(${PC_NAME})\b${CONTEXT_JOIN}\b(${CONTEXT_WORD})\b`,
  'g',
);
const COMPUTERISH_SUFFIX = /^(?:PC|DESKTOP|LAPTOP|IMAC|MAC|MACBOOK|WORKSTATION)$/i;

export function isPlaceholderUser(raw) {
  const user = String(raw ?? '').replace(/^[/\\]+|[/\\]+$/g, '');
  if (!user) return true;
  const folded = user.toLowerCase();
  if (SYSTEM_USERS.has(folded)) return true;
  if (user.startsWith('<') && user.endsWith('>') && user.length > 2) return true;
  if (/^%[A-Za-z][A-Za-z0-9_]+%$/.test(user)) return true;
  return user === '~' || user === '$HOME' || user === '$USER' || user === '$USERNAME';
}

export function isAllowlistedDiffPath(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  if (!normalized) return false;
  return DIFF_PATH_ALLOWLIST.some((pattern) => {
    if (pattern === normalized) return true;
    if (!pattern.includes('*')) return false;
    try {
      return path.matchesGlob(normalized, pattern);
    } catch {
      return false;
    }
  });
}

export function isRetinaImageName(local, domain) {
  return /^[23]x\.[A-Za-z][A-Za-z0-9]*$/i.test(String(domain ?? ''));
}

export function isAllowedEmail(local, domain) {
  const host = String(domain ?? '').toLowerCase();
  const mailbox = String(local ?? '').toLowerCase();
  if (!host || host === 'localhost') return true;
  if (mailbox === 'git' && host === 'github.com') return true;
  if (mailbox === 'cursoragent' && host === 'cursor.com') return true;
  if (mailbox === 'noreply' || mailbox === 'no-reply') return true;
  if (ALLOWED_EMAIL_DOMAINS.has(host)) return true;
  if ([...ALLOWED_EMAIL_DOMAINS].some((allowed) => host.endsWith(`.${allowed}`))) return true;
  if (WHATSAPP_JID_DOMAINS.has(host)) return true;
  if (RESERVED_EMAIL_TLDS.has(host.split('.').pop())) return true;
  if (isRetinaImageName(local, host)) return true;
  return false;
}

export function isPlaceholderHostname(raw) {
  const host = String(raw ?? '');
  if (host.startsWith('<') && host.endsWith('>') && host.length > 2) return true;
  return PLACEHOLDER_MDNS.has(host.toLowerCase());
}

export function isHostnameShapedMdns(label) {
  // Personal Bonjour names are hyphenated (alice-office, Alices-MacBook-Pro).
  // A single JS identifier such as foo.local or x.local is property access.
  return String(label ?? '').includes('-');
}

export function isJsLocalAccess(text, matchIndex, matchLength) {
  const next = String(text ?? '')[(matchIndex ?? 0) + (matchLength ?? 0)];
  return next === '(' || next === '[';
}

export function isWindowsPcNameHit(name, contextWord, phrase) {
  if (!name || isPlaceholderHostname(name.split('_')[0])) return false;
  const suffix = name.split('_').slice(1).join('_');
  if (!/^hosts?$/i.test(contextWord)) return true;
  if (COMPUTERISH_SUFFIX.test(suffix)) return true;
  return /\bhost(?:s|name)?\b[\s:,'"-]+(?:name|called|named)|\b(?:name|called|named)[\s:,'"-]+host/i.test(phrase);
}

function pushHit(hits, type, match, start) {
  hits.push({ type, match, start: start ?? 0 });
}

function collectRegexHits(text, regex, type, decide) {
  const hits = [];
  regex.lastIndex = 0;
  let found;
  while ((found = regex.exec(text)) !== null) {
    const decision = decide(found);
    if (!decision) continue;
    pushHit(hits, type, decision.match ?? found[0], found.index + (decision.offset ?? 0));
    if (found[0].length === 0) regex.lastIndex += 1;
  }
  return hits;
}

export function findPersonalInfo(text) {
  if (!text) return [];
  const hits = [];

  hits.push(...collectRegexHits(text, WINDOWS_USER, 'windows-user-profile', (found) => {
    if (isPlaceholderUser(found[2])) return null;
    return { match: `${found[1]}${found[2]}`, offset: found[0].startsWith(found[1]) ? 0 : found[0].length - found[1].length - found[2].length };
  }));
  hits.push(...collectRegexHits(text, MAC_USER, 'macos-user-path', (found) => {
    if (isPlaceholderUser(found[2])) return null;
    return { match: `${found[1]}${found[2]}`, offset: found[0].indexOf(found[1]) };
  }));
  hits.push(...collectRegexHits(text, LINUX_USER, 'linux-user-path', (found) => {
    if (isPlaceholderUser(found[2])) return null;
    return { match: `${found[1]}${found[2]}`, offset: found[0].indexOf(found[1]) };
  }));
  hits.push(...collectRegexHits(text, EMAIL, 'email', (found) => {
    if (isAllowedEmail(found[1], found[2])) return null;
    return { match: found[0] };
  }));
  hits.push(...collectRegexHits(text, MDNS, 'mdns-hostname', (found) => {
    if (isJsLocalAccess(text, found.index, found[0].length)) return null;
    if (isPlaceholderHostname(found[1])) return null;
    if (!isHostnameShapedMdns(found[1])) return null;
    return { match: found[0] };
  }));
  hits.push(...collectRegexHits(text, WINDOWS_COMPUTER, 'windows-computer-name', (found) => {
    if (found[2].startsWith('<') && found[2].endsWith('>')) return null;
    return { match: found[0] };
  }));
  hits.push(...collectRegexHits(text, PC_AFTER_CONTEXT, 'windows-pc-name', (found) => {
    if (!isWindowsPcNameHit(found[2], found[1], found[0])) return null;
    return { match: found[2], offset: found[0].lastIndexOf(found[2]) };
  }));
  hits.push(...collectRegexHits(text, PC_BEFORE_CONTEXT, 'windows-pc-name', (found) => {
    if (!isWindowsPcNameHit(found[1], found[2], found[0])) return null;
    return { match: found[1] };
  }));

  hits.sort((left, right) => left.start - right.start || left.type.localeCompare(right.type));
  return hits;
}

export function maskSnippet(type, match) {
  let masked = String(match ?? '');
  if (type === 'windows-user-profile' || type === 'macos-user-path' || type === 'linux-user-path') {
    masked = masked.replace(
      /((?:[A-Za-z]:)?[/\\]+(?:Users|home)[/\\]+)([^/\\]+)/i,
      (_, prefix) => `${prefix}••••`,
    );
  } else if (type === 'email') {
    masked = masked.replace(/^[^@]+@([^.]+)/, '••••@••••');
  } else if (type === 'mdns-hostname') {
    masked = masked.replace(/^[^.]+/, '••••');
  } else if (type === 'windows-computer-name') {
    masked = masked.replace(/\b(DESKTOP|LAPTOP)-[A-Z0-9<>-]+/gi, '$1-••••');
  } else if (type === 'windows-pc-name') {
    masked = '••••_••••';
  } else {
    masked = '••••';
  }
  if (masked.length > 42) masked = `${masked.slice(0, 40)}…`;
  return masked;
}

export function addedLinesFromPatch(patch) {
  if (!patch) return [];
  const added = [];
  let newLine = 0;
  for (const raw of patch.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) continue;
    if (raw.startsWith(' ') || raw === '') newLine += 1;
  }
  return added;
}

export function collectFindings({ title = '', body = '', files = [] } = {}) {
  const findings = [];
  for (const hit of findPersonalInfo(title)) {
    findings.push({ source: 'title', type: hit.type, snippet: maskSnippet(hit.type, hit.match) });
  }
  for (const hit of findPersonalInfo(body)) {
    findings.push({ source: 'body', type: hit.type, snippet: maskSnippet(hit.type, hit.match) });
  }
  for (const file of files) {
    const filename = file?.filename;
    if (!filename || isAllowlistedDiffPath(filename)) continue;
    for (const added of addedLinesFromPatch(file.patch)) {
      for (const hit of findPersonalInfo(added.text)) {
        findings.push({
          source: 'diff',
          file: filename,
          line: added.line,
          type: hit.type,
          snippet: maskSnippet(hit.type, hit.match),
        });
      }
    }
  }
  return findings;
}

export function formatReport(findings) {
  const lines = [
    'Personal machine details cannot appear in this public repo, its pull requests or issues.',
    '',
  ];
  for (const finding of findings) {
    if (finding.source === 'diff') {
      lines.push(`  diff ${finding.file}:+${finding.line}: ${finding.type}  ${finding.snippet}`);
    } else {
      lines.push(`  ${finding.source}: ${finding.type}  ${finding.snippet}`);
    }
  }
  lines.push('');
  lines.push('Use repo-relative paths, placeholders such as <name>, <user>, %USERPROFILE% or ~, localhost, and example.com.');
  lines.push('Editing the pull request title or body re-runs this check without a new push.');
  return lines.join('\n');
}

export function parseScanWorkflowPolicy(yaml) {
  const checkoutRef = yaml.match(/^\s+ref:\s*(.+)$/m)?.[1].trim() ?? null;
  const concurrencyGroup = yaml.match(/^\s+group:\s*(.+)$/m)?.[1].trim() ?? null;
  const cancelInProgress = yaml.match(/^\s+cancel-in-progress:\s*(.+)$/m)?.[1].trim() ?? null;
  return {
    checkoutRef,
    persistCredentialsFalse: /^\s+persist-credentials:\s*false\s*$/m.test(yaml),
    checksOutDefaultBranch: checkoutRef === TRUSTED_CHECKOUT_REF,
    checksOutPrHead: /^\s+ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)\s*\}\}\s*$/m.test(yaml),
    hasPullRequestTarget: /^ {2}pull_request_target:\s*$/m.test(yaml),
    targetTypes: (yaml.match(/pull_request_target:[\s\S]*?types:\s*\[([^\]]+)\]/)?.[1] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    interpolatesTitleOrBody: /github\.event\.pull_request\.(title|body)/.test(yaml),
    concurrencyGroup,
    cancelInProgress,
    concurrencyIncludesHeadSha: /github\.event\.pull_request\.head\.sha/.test(concurrencyGroup ?? ''),
    cancelInProgressSkipsEdited: cancelInProgress === "${{ github.event.action != 'edited' }}",
  };
}

export function isRateLimitError(error) {
  const text = `${error?.stderr ?? ''}\n${error?.message ?? ''}\n${error?.stdout ?? ''}`;
  return /rate limit exceeded/i.test(text);
}

export function ghApi(repo, token, requestPath, { paginate = false, retries = 6 } = {}) {
  const args = ['api', `repos/${repo}/${requestPath}`, '-H', 'Accept: application/vnd.github+json'];
  if (paginate) args.splice(1, 0, '--paginate');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = execFileSync('gh', args, {
        env: { ...process.env, GH_TOKEN: token },
        encoding: 'utf8',
        windowsHide: true,
      });
      return result ? JSON.parse(result) : null;
    } catch (error) {
      if (!isRateLimitError(error) || attempt === retries) throw error;
      const wait = Math.min(32, 2 ** (attempt + 2));
      console.log(`GitHub API rate limited; retrying in ${wait}s…`);
      execFileSync('sleep', [String(wait)], { windowsHide: true });
    }
  }
  return null;
}

export function fetchPrFiles(repo, prNumber, token) {
  const payload = ghApi(repo, token, `pulls/${prNumber}/files?per_page=100`, { paginate: true });
  return Array.isArray(payload) ? payload : [];
}

export function readPullRequestEvent(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pullRequest = event?.pull_request;
  if (!pullRequest || typeof pullRequest !== 'object') {
    throw new Error('Event payload has no pull_request');
  }
  return {
    number: pullRequest.number,
    title: typeof pullRequest.title === 'string' ? pullRequest.title : '',
    body: typeof pullRequest.body === 'string' ? pullRequest.body : '',
  };
}

export function scanPullRequest({ title, body, files }) {
  const findings = collectFindings({ title, body, files });
  return {
    findings,
    ok: findings.length === 0,
    report: findings.length ? formatReport(findings) : 'No personal machine details in the PR title, body, or added lines.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const pullRequest = readPullRequestEvent();
  if (!repo || !token || pullRequest.number == null) {
    console.error('Missing required scan inputs: repo, token, or pull request number.');
    process.exit(1);
  }
  const files = fetchPrFiles(repo, pullRequest.number, token);
  const result = scanPullRequest({
    title: pullRequest.title,
    body: pullRequest.body,
    files,
  });
  if (!result.ok) {
    console.error(result.report);
    process.exit(1);
  }
  console.log(result.report);
}
