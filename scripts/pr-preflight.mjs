#!/usr/bin/env node
// Local preflight: runs the gate checks that need no CI infrastructure, before a push or a PR body edit.
// Reuses the gates' own exported checks and config so the rules cannot drift. Prints one line per problem, with the fix.
// Usage: node scripts/pr-preflight.mjs --body <draft-body.md> [--title <PR title>] [--base origin/main] [--cloud-agent]
// Without --title the title is the HEAD commit subject; pass the PR title when it differs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSelfCheck } from './check-self-check.mjs';
import { checkUIProof } from './check-ui-proof.mjs';
import { ALLOWED_SUFFIX, FIX_LINES, evaluateCommits, fetchPrCommitsWithApi } from './check-commit-emails.mjs';
import {
  changedFilesFromPrFiles,
  coverageFromPrFiles,
  evaluateGateChangeReview,
  fetchFileText,
  fetchPrFiles,
  gateApiBudget,
  ghApi,
  loadProtectedGatePaths,
} from './merge-gate-trusted.mjs';
import { checkWindowClean, scanTree } from './check-window-clean.mjs';

const PERSONAL_PATTERNS = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/,
  /\b[A-Za-z0-9._%+-]+@(gmail|outlook|hotmail|yahoo|icloud|proton)\.[a-z.]+\b/i,
];
// Test files carry synthetic fixtures (example addresses, sample paths) on purpose, so they are exempt.
const FIXTURE_FILE = /\.test\.(mjs|ts|tsx)$/;
const WINDOW_INPUTS = /^(window\/|scripts\/window-clean)/;
const SHARD_INPUTS = /^(scripts\/feature-batch-ci|\.github\/workflows\/feature-batch-checks\.yml|scripts\/feature-batch-ci-named\/)/;
// Which slow local checks a change needs: the window-clean scan and the shard-budget test.
export function scopedChecks(changedFiles) {
  return {
    window: changedFiles.some((f) => WINDOW_INPUTS.test(f)),
    shard: changedFiles.some((f) => SHARD_INPUTS.test(f)),
  };
}

const ENGINE_OR_WINDOW_TEST = /^(engine|window)\/.+\.test\.(?:ts|tsx|mjs|mts)$/;
const TEST_FILE = /^(engine|window|desktop)\/.+\.test\.(?:ts|tsx|mjs|mts)$/;

const problem = (check, message, fix) => ({ check, message, fix });

// The Taofik trailer the gate's own fix text asks cloud agents to use. Read from the gate, never copied.
export function cloudAgentTrailer() {
  const text = FIX_LINES.join('\n');
  const match = /`(Co-authored-by:[^`]+)`/.exec(text);
  if (!match) throw new Error('check-commit-emails.mjs FIX_LINES no longer names a Co-authored-by trailer');
  return match[1];
}

// Commit identity: the same rules check-commit-emails.mjs applies. The fix text comes from the gate's own suffix.
export function commitProblems(commits, { cloudAgent = false } = {}) {
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
    `set git user.email to a GitHub noreply address (ending ${ALLOWED_SUFFIX}), then make a new commit. Never force-push`,
  ));
  if (!cloudAgent) return addressProblems;
  const trailer = cloudAgentTrailer();
  const trailerProblems = commits
    .filter((c) => !c.message.toLowerCase().includes(trailer.toLowerCase()))
    .map((c) => problem('trailer', `cloud-agent commit ${c.sha} has no required trailer`, `end the commit message with: ${trailer}`));
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
export function namedListProblems({ changedFiles, listText, listPath }) {
  const wanted = changedFiles.filter((f) => ENGINE_OR_WINDOW_TEST.test(f)).map((f) => f.replace(/^(engine|window)\//, '$1:')).sort();
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

// The gate's own review: protected files (its workflows, CODEOWNERS, invoked scripts) need the reviewer marker for this head.
export function gateFileProblems({ changedFiles, body, headSha, protectedPaths }) {
  const review = evaluateGateChangeReview({ changedFiles, body: body ?? '', headSha, protectedPaths });
  if (review.ok) return [];
  return [problem(
    'gate-files',
    `protected gate file(s) changed without a reviewer marker for this head: ${review.protectedFiles.join(', ')}`,
    'this change needs a non-author review of this exact head; GOD adds the gate-change-reviewed marker after approval. Do not add it yourself',
  )];
}

// Desktop tests are covered by desktop-checks.yml, not by a named list. The gate's own coverage rule decides.
export function desktopCoverageProblems({ files, desktopWorkflow }) {
  if (desktopWorkflow == null) return [];
  const { uncovered } = coverageFromPrFiles(files, desktopWorkflow);
  return uncovered.filter((file) => file.startsWith('desktop/')).map((file) => problem(
    'desktop-tests',
    `${file} is not run by desktop-checks.yml`,
    'add a node --test step for it to .github/workflows/desktop-checks.yml, as the gate requires',
  ));
}

// A fix, perf or refactor PR must say what it checked before it changed code: upstream, peer agents or the old code.
const PRIOR_ART_TITLE = /^(fix|perf|refactor)(\([^)]*\))?!?:/;
const PRIOR_ART_LINE = /^\s*(?:[-*]\s*)?Prior art:(.*)$/im;
const PRIOR_ART_SOURCE = /\b(upstream|upstream|peer|old code|replaces|hermes|codex|agent-refs)\b/i;
const PRIOR_ART_FIX = 'add a line "Prior art: <what you checked>" naming upstream project, peer agents or the old code it replaces, or "Prior art: none found: <what you checked>"';

export function priorArtProblems({ title, body }) {
  if (!PRIOR_ART_TITLE.test(title ?? '')) {
    return [];
  }
  const line = PRIOR_ART_LINE.exec(body ?? '');
  if (!line) {
    return [problem('prior-art', `title "${title}" needs a "Prior art:" line in the body and has none`, PRIOR_ART_FIX)];
  }
  const text = line[1].trim();
  if (/^none found:\s*\S/i.test(text) || PRIOR_ART_SOURCE.test(text)) {
    return [];
  }
  return [problem('prior-art', 'the "Prior art:" line names no source checked', PRIOR_ART_FIX)];
}

export function personalInfoProblems(addedLines) {
  const real = addedLines.filter((l) => !FIXTURE_FILE.test(l.file));
  return real.filter((l) => PERSONAL_PATTERNS.some((p) => p.test(l.text))).map((l) => (
    problem('personal-info', `${l.file}:${l.line} contains a personal path or email`, 'replace it with a placeholder or remove it')
  ));
}

export function unverifiedPatchProblems(files) {
  return files.map((file) => problem(
    'personal-info',
    `cannot check ${file} for personal paths: the API returned no patch (large or binary diff)`,
    'split the change into smaller files, or run preflight locally so the file is read from git',
  ));
}

// CI mode cannot run these checks without a checkout. Each one is named, never passed silently.
export function ciSkippedLines() {
  return ['clean-tree', 'window-clean', 'shard-budget'].map((name) => `skipped: ${name} (needs local repo)`);
}

export function dirtyTreeProblems(dirtyCount) {
  if (dirtyCount === 0) return [];
  return [problem('clean-tree', `working tree has ${dirtyCount} uncommitted change(s)`, 'commit or stash them; the gates test the pushed commit')];
}

// Pure entry point: every check runs from the inputs given, so tests can feed each failure type.
export function runPreflight(input) {
  const body = input.body ?? '';
  const changedFiles = input.changedFiles ?? [];
  const protectedPaths = input.protectedPaths ?? loadProtectedGatePaths();
  return [
    ...dirtyTreeProblems(input.dirtyCount ?? 0),
    ...commitProblems(input.commits ?? [], { cloudAgent: input.cloudAgent === true }),
    ...selfCheckProblems({ branch: input.branch, headSha: input.headSha, body }),
    ...namedListProblems({ changedFiles, listText: input.listText ?? null, listPath: input.listPath }),
    ...priorArtProblems({ title: input.title, body }),
    ...uiProofProblems({ changedFiles, body }),
    ...windowCleanProblems(input.windowResult),
    ...shardProblems(input.shardResult),
    ...gateFileProblems({ changedFiles, body, headSha: input.headSha, protectedPaths }),
    ...desktopCoverageProblems({ files: input.files ?? [], desktopWorkflow: input.desktopWorkflow ?? null }),
    ...personalInfoProblems(input.addedLines ?? []),
    ...unverifiedPatchProblems(input.unverifiedFiles ?? []),
  ];
}

export function formatProblems(problems) {
  if (problems.length === 0) return 'preflight: ok';
  const lines = problems.map((p) => `preflight FAIL [${p.check}] ${p.message.replace(/\.$/, '')}. Fix: ${p.fix}`);
  lines.push(`preflight: ${problems.length} problem(s)`);
  return lines.join('\n');
}

// ---- CLI: gather inputs from git and the body file.
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

// File statuses in the shape the gate's coverage rule reads (renames count as added, as in the gate).
export function filesFromNameStatus(text) {
  return String(text ?? '').split('\n').filter(Boolean).flatMap((line) => {
    const parts = line.split('\t');
    const code = parts[0];
    if (code.startsWith('R')) return [{ filename: parts[2], status: 'added' }];
    if (code === 'D') return [{ filename: parts[1], status: 'removed' }];
    if (code === 'A') return [{ filename: parts[1], status: 'added' }];
    return [{ filename: parts[1], status: 'modified' }];
  });
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
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

function gatherInputs({ argv, cwd }) {
  const base = argValue('--base', argv) ?? 'origin/main';
  const bodyPath = argValue('--body', argv);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const listPath = `scripts/feature-batch-ci-named/${branch.replace(/\//g, '-')}.txt`;
  const listAbs = path.join(cwd, listPath);
  return {
    branch,
    headSha: git(['rev-parse', 'HEAD'], cwd),
    title: argValue('--title', argv) ?? git(['log', '-1', '--format=%s'], cwd),
    body: bodyPath && existsSync(path.resolve(cwd, bodyPath)) ? readFileSync(path.resolve(cwd, bodyPath), 'utf8') : null,
    dirtyCount: git(['status', '--porcelain'], cwd).split('\n').filter(Boolean).length,
    commits: gitCommits(base, cwd),
    changedFiles: git(['diff', '--name-only', `${base}...HEAD`], cwd).split('\n').filter(Boolean),
    files: filesFromNameStatus(git(['diff', '--name-status', `${base}...HEAD`], cwd)),
    desktopWorkflow: readIfExists(path.join(cwd, '.github/workflows/desktop-checks.yml')),
    addedLines: gitAddedLines(base, cwd),
    cloudAgent: argv.includes('--cloud-agent'),
    listPath,
    listText: existsSync(listAbs) ? readFileSync(listAbs, 'utf8') : null,
  };
}

function windowResultFor(cwd) {
  const baselinePath = path.join(cwd, 'scripts/window-clean-baseline.txt');
  if (!existsSync(baselinePath)) return null;
  return checkWindowClean(scanTree(cwd), readFileSync(baselinePath, 'utf8'));
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

export function namedListPathFor(branch) {
  return `scripts/feature-batch-ci-named/${branch.replace(/\//g, '-')}.txt`;
}

// Added lines from one file's patch, with their line numbers in the new file.
export function addedLinesFromPatch(file, patch) {
  const added = [];
  let line = 0;
  for (const raw of String(patch ?? '').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (hunk) line = Number(hunk[1]);
    else if (raw.startsWith('+')) { added.push({ file, line, text: raw.slice(1) }); line += 1; }
    else if (raw.startsWith(' ')) line += 1;
  }
  return added;
}

function commitFromApi(c) {
  return {
    sha: c.sha,
    message: c.commit?.message ?? '',
    authorEmail: c.commit?.author?.email ?? '',
    committerEmail: c.commit?.committer?.email ?? '',
    date: c.commit?.committer?.date ?? '',
  };
}

// CI mode: the same inputs preflight builds locally, read from the pull request's API data.
// `api` is injectable so the assembly is testable without the network.
// GitHub omits `patch` for large or binary diffs. Such a file cannot be checked, so it is reported, not passed.
export function unverifiedFileNames(files) {
  return files
    .filter((f) => f.status !== 'removed' && typeof f.patch !== 'string' && (f.changes ?? 0) > 0)
    .map((f) => f.filename);
}

export function inputFromApi({ headBranch, headSha, files, commits, listText, desktopWorkflow = null, title = '' }) {
  return {
    branch: headBranch,
    headSha,
    title,
    files,
    desktopWorkflow,
    dirtyCount: 0,
    commits: commits.map(commitFromApi),
    changedFiles: changedFilesFromPrFiles(files),
    addedLines: files.flatMap((f) => addedLinesFromPatch(f.filename, f.patch)),
    unverifiedFiles: unverifiedFileNames(files),
    listPath: namedListPathFor(headBranch),
    listText: listText ?? null,
    windowResult: null,
    shardResult: null,
  };
}

// The CI job-wide wait budget for every GitHub call the preflight makes. Invalid values fall back to the default.
export const PREFLIGHT_DEFAULT_BUDGET_SECONDS = 120;
export function preflightBudgetSeconds(env = process.env) {
  const value = Number(env.PREFLIGHT_WAIT_SECONDS);
  return Number.isInteger(value) && value > 0 ? value : PREFLIGHT_DEFAULT_BUDGET_SECONDS;
}

function apiInputFromEnv(env) {
  const repo = env.REPO;
  const prNumber = env.PR_NUMBER;
  const token = env.GITHUB_TOKEN;
  const headSha = env.HEAD_SHA;
  const headBranch = env.HEAD_BRANCH;
  if (!repo || !prNumber || !token || !headSha || !headBranch) {
    throw new Error('CI mode needs REPO, PR_NUMBER, GITHUB_TOKEN, HEAD_SHA and HEAD_BRANCH');
  }
  // The live title and body from the API: the event payload can predate an edit, so CI never reads them from there.
  const pr = ghApi(repo, token, `pulls/${prNumber}`);
  const body = typeof pr?.body === 'string' ? pr.body : '';
  const title = typeof pr?.title === 'string' ? pr.title : '';
  const files = fetchPrFiles(repo, prNumber, token);
  const commits = fetchPrCommitsWithApi({ repo, prNumber, token });
  const listText = fetchFileText(repo, headSha, token, namedListPathFor(headBranch));
  const desktopWorkflow = fetchFileText(repo, headSha, token, '.github/workflows/desktop-checks.yml');
  return { ...inputFromApi({ headBranch, headSha, files, commits, listText, desktopWorkflow, title }), body };
}

// Exported so tests can drive the real CLI wiring against a temporary repository.
export function runCli(argv, cwd, env = process.env, { ciInput = apiInputFromEnv } = {}) {
  if (argv.includes('--ci')) {
    // CI reads the live body and its own inputs from the API under one job-wide budget.
    const budgetSeconds = preflightBudgetSeconds(env);
    gateApiBudget.budgetSeconds = budgetSeconds;
    gateApiBudget.startedAt = Date.now();
    let input;
    try {
      input = ciInput(env);
    } catch (error) {
      const reason = String(error?.message ?? error).split('\n')[0];
      return {
        exitCode: 1,
        text: [...ciSkippedLines(), `preflight could not read GitHub within its ${budgetSeconds}s budget (${reason}). This is not a preflight failure; re-run the check.`].join('\n'),
      };
    }
    const problems = runPreflight({ ...input, cloudAgent: false });
    return { exitCode: problems.length ? 1 : 0, text: [...ciSkippedLines(), formatProblems(problems)].join('\n') };
  }
  if (!argv.includes('--body')) {
    return { exitCode: 2, text: 'preflight: pass --body <draft PR body file>. Preflight checks the body you are about to submit.' };
  }
  const input = gatherInputs({ argv, cwd });
  // Both checks are slow (a whole-tree scan, a test run), so each runs only when its own inputs changed.
  const scope = scopedChecks(input.changedFiles);
  input.windowResult = scope.window ? windowResultFor(cwd) : null;
  input.shardResult = scope.shard ? shardResultFor(cwd) : null;
  const problems = runPreflight(input);
  return { exitCode: problems.length ? 1 : 0, text: formatProblems(problems) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = runCli(process.argv.slice(2), repoRoot);
  console.log(result.text);
  process.exitCode = result.exitCode;
}
