#!/usr/bin/env node
// Local preflight: runs the gate checks that need no CI infrastructure, before a push or a PR body edit.
// Reuses the gates' own exported checks so the rules cannot drift. Prints one line per problem, with the fix.
// Usage: node scripts/pr-preflight.mjs --body <draft-body.md> [--base origin/main]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSelfCheck } from './check-self-check.mjs';
import { checkUIProof } from './check-ui-proof.mjs';
import { classifyAddress, evaluateCommits } from './check-commit-emails.mjs';
import { listedGateFiles, touchedGateFiles } from './check-gate-files-fresh.mjs';
import { checkWindowClean, scanTree } from './check-window-clean.mjs';

export const TRAILER = 'Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>';
export const NOREPLY_EMAIL = '189563683+stabrea@users.noreply.github.com';
const PERSONAL_PATTERNS = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/,
  /\b[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|icloud|proton)\.[a-z.]+\b/i,
];
const TEST_FILE = /^(engine|window)\/.+\.test\.(ts|tsx|mjs)$/;

const problem = (check, message, fix) => ({ check, message, fix });

// Commit identity and trailers: the same rules check-commit-emails.mjs applies, plus the trailer every commit needs.
export function commitProblems(commits) {
  const apiCommits = commits.map((c) => ({
    sha: c.sha,
    commit: {
      message: c.message,
      author: { email: c.authorEmail, date: c.date },
      committer: { email: c.committerEmail, date: c.date },
    },
  }));
  const addressProblems = evaluateCommits(apiCommits).map((f) => problem(
    'commit-email',
    `commit ${f.sha} ${f.field} address ${f.hint} is not a GitHub noreply address`,
    `git config user.email ${NOREPLY_EMAIL}, then make a new commit (no force-push). A Co-authored-by line must be a noreply address too`,
  ));
  const trailerProblems = commits
    .filter((c) => !c.message.toLowerCase().includes(TRAILER.toLowerCase()))
    .map((c) => problem('trailer', `commit ${c.sha} has no Taofik trailer`, `end the commit message with: ${TRAILER}`));
  return [...addressProblems, ...trailerProblems];
}

// The SELF-CHECK block must exist, be valid, and name the head this push is actually at.
export function selfCheckProblems({ branch, headSha, body }) {
  const problems = checkSelfCheck({ headRef: branch, body }).problems.map((message) => problem(
    'self-check', message, 'edit the draft body file, then rerun preflight',
  ));
  const final = /Final head:\s*([0-9a-f]{40})/i.exec(body ?? '');
  if (final && final[1].toLowerCase() !== headSha.toLowerCase()) {
    problems.push(problem('self-check', `Final head ${final[1].slice(0, 9)} is stale; HEAD is ${headSha.slice(0, 9)}`, `set "Final head: ${headSha}" in the body`));
  }
  return problems;
}

// Named-test list: every changed engine or window test file must appear in the branch's list, sorted.
export function namedListProblems({ branch, changedFiles, listText, listPath }) {
  const wanted = changedFiles.filter((f) => TEST_FILE.test(f)).map((f) => f.replace(/^(engine|window)\//, '$1:')).sort();
  if (wanted.length === 0) return [];
  if (listText == null) {
    return [problem('named-tests', `no named-test list for ${wanted.length} changed test file(s)`, `create ${listPath} with these lines: ${wanted.join(' ')}`)];
  }
  const have = listText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const missing = wanted.filter((w) => !have.includes(w));
  const problems = missing.map((w) => problem('named-tests', `${listPath} lacks ${w}`, `add the line ${w}`));
  if (JSON.stringify(have) !== JSON.stringify([...have].sort())) {
    problems.push(problem('named-tests', `${listPath} is not sorted`, `sort the lines in ${listPath}`));
  }
  return problems;
}

export function uiProofProblems({ changedFiles, body }) {
  const result = checkUIProof(changedFiles, body ?? '');
  if (result.exitCode === 0) return [];
  return [problem('ui-proof', result.message.split('\n')[0], 'add a screenshot image or link to the body, or the line "No visible change: <reason>"')];
}

export function windowCleanProblems(windowResult) {
  if (!windowResult || windowResult.ok) return [];
  const first = String(windowResult.text ?? '').split('\n').find((l) => l.trim()) ?? 'window-clean baseline differs';
  return [problem('window-clean', first.trim(), 'run node scripts/check-window-clean.mjs and follow its report; do not add lines to the baseline')];
}

export function shardProblems(shardResult) {
  if (!shardResult || shardResult.ok) return [];
  return [problem('shard-budget', `scripts/feature-batch-ci-shard.test.mjs fails: ${shardResult.detail}`, 'split the new tests or move them to a shard with headroom; rerun node --test scripts/feature-batch-ci-shard.test.mjs')];
}

export function gateFileProblems(changedFiles) {
  const touched = touchedGateFiles(changedFiles, listedGateFiles());
  if (touched.length === 0) return [];
  return [problem('gate-files', `gate file(s) changed: ${touched.join(', ')}`, 'open this as its own PR; it needs a gate-change-reviewed marker for the head SHA')];
}

// Test files carry synthetic fixtures (example addresses, sample paths) on purpose, so they are exempt.
const FIXTURE_FILE = /\.test\.(mjs|ts|tsx)$/;
export function personalInfoProblems(addedLines) {
  const real = addedLines.filter((l) => !FIXTURE_FILE.test(l.file));
  return real.filter((l) => PERSONAL_PATTERNS.some((p) => p.test(l.text))).map((l) => (
    problem('personal-info', `${l.file}:${l.line} contains a personal path or email`, 'replace it with a placeholder or remove it')
  ));
}

export function dirtyTreeProblems(dirtyCount) {
  if (dirtyCount === 0) return [];
  return [problem('clean-tree', `working tree has ${dirtyCount} uncommitted change(s)`, 'commit or stash them; the gates test the pushed commit')];
}

// Pure entry point: every check runs from the inputs given, so tests can feed each failure type.
export function runPreflight(input) {
  const body = input.body ?? '';
  return [
    ...dirtyTreeProblems(input.dirtyCount ?? 0),
    ...commitProblems(input.commits ?? []),
    ...selfCheckProblems({ branch: input.branch, headSha: input.headSha, body }),
    ...namedListProblems({ branch: input.branch, changedFiles: input.changedFiles ?? [], listText: input.listText ?? null, listPath: input.listPath }),
    ...uiProofProblems({ changedFiles: input.changedFiles ?? [], body }),
    ...windowCleanProblems(input.windowResult),
    ...shardProblems(input.shardResult),
    ...gateFileProblems(input.changedFiles ?? []),
    ...personalInfoProblems(input.addedLines ?? []),
  ];
}

export function formatProblems(problems) {
  if (problems.length === 0) return 'preflight: ok';
  const lines = problems.map((p) => `preflight FAIL [${p.check}] ${p.message.replace(/\.$/, '')}. Fix: ${p.fix}`);
  lines.push(`preflight: ${problems.length} problem(s)`);
  return lines.join('\n');
}

// ---- CLI: gather inputs from git and the body file. Not exercised by the unit tests.
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitCommits(base, cwd) {
  const out = git(['log', `${base}..HEAD`, '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%cI%x1f%B%x1e'], cwd);
  return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, , authorEmail, , committerEmail, date, ...msg] = r.split('\x1f');
    return { sha, authorEmail, committerEmail, date, message: msg.join('\x1f') };
  });
}

function gitAddedLines(base, cwd) {
  const diff = git(['diff', '-U0', `${base}...HEAD`], cwd);
  const added = [];
  let file = '';
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) file = raw.slice(6);
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) line = Number(hunk[1]);
    else if (raw.startsWith('+') && !raw.startsWith('+++')) { added.push({ file, line, text: raw.slice(1) }); line += 1; }
  }
  return added;
}

function argValue(name, argv) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
}

function gatherCli(argv) {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base = argValue('--base', argv) ?? 'origin/main';
  const bodyPath = argValue('--body', argv);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const listPath = `scripts/feature-batch-ci-named/${branch.replace(/\//g, '-')}.txt`;
  const listAbs = path.join(cwd, listPath);
  return {
    branch,
    headSha: git(['rev-parse', 'HEAD'], cwd),
    body: bodyPath && existsSync(bodyPath) ? readFileSync(bodyPath, 'utf8') : null,
    dirtyCount: git(['status', '--porcelain'], cwd).split('\n').filter(Boolean).length,
    commits: gitCommits(base, cwd),
    changedFiles: git(['diff', '--name-only', `${base}...HEAD`], cwd).split('\n').filter(Boolean),
    addedLines: gitAddedLines(base, cwd),
    listPath,
    listText: existsSync(listAbs) ? readFileSync(listAbs, 'utf8') : null,
    windowResult: null,
    shardResult: null,
    cwd,
  };
}

function windowResultFor(cwd) {
  const baseline = readFileSync(path.join(cwd, 'scripts/window-clean-baseline.txt'), 'utf8');
  return checkWindowClean(scanTree(cwd), baseline);
}

function shardResultFor(cwd) {
  try {
    execFileSync('node', ['--test', 'scripts/feature-batch-ci-shard.test.mjs'], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, detail: '' };
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    const line = text.split('\n').find((l) => /budget|not ok/.test(l)) ?? 'see node --test output';
    return { ok: false, detail: line.trim().slice(0, 200) };
  }
}

async function main() {
  if (!process.argv.includes('--body')) {
    console.error('preflight: pass --body <draft PR body file>. Preflight checks the body you are about to submit.');
    process.exitCode = 2;
    return;
  }
  const input = gatherCli(process.argv.slice(2));
  const changesTests = input.changedFiles.some((f) => TEST_FILE.test(f));
  input.windowResult = windowResultFor(input.cwd);
  input.shardResult = changesTests ? shardResultFor(input.cwd) : null;
  const problems = runPreflight(input);
  console.log(formatProblems(problems));
  if (problems.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
