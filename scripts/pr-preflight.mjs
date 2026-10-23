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
import { explainFinalHeadDrift } from './final-head-history.mjs';
import { checkCommittedProofImages, checkUIProof } from './check-ui-proof.mjs';
import { ALLOWED_SUFFIX, FIX_LINES, evaluateCommits, fetchPrCommitsWithApi } from './check-commit-emails.mjs';
import {
  changedFilesFromPrFiles,
  coverageFromPrFiles,
  evaluateGateChangeReview,
  fetchFileTextsBatch,
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

// The SELF-CHECK block must exist and be valid. Final head must be this head, or this head
// may be that commit plus later merges that only bring main in.
export function selfCheckProblems({ branch, headSha, body, repoDir }) {
  const problems = checkSelfCheck({ headRef: branch, body }).problems.map((message) => problem(
    'self-check', message, 'edit the draft body file, then rerun preflight',
  ));
  const final = /Final head:\s*([0-9a-f]{40})/i.exec(body ?? '');
  if (final && final[1].toLowerCase() !== headSha.toLowerCase()) {
    const drift = repoDir ? explainFinalHeadDrift({ repoDir, namedSha: final[1], headSha }) : { ok: false, known: false };
    if (!drift.ok) {
      const message = drift.known
        ? drift.message
        : `Final head ${final[1].slice(0, 9)} is stale; HEAD is ${headSha.slice(0, 9)}`;
      problems.push(problem('self-check', message, `set "Final head: ${headSha}" in the body`));
    }
  }
  return problems;
}

// Named-test list: every changed engine or window test file must appear in the branch's list, in any order.
// Only one PR edits its own list, so order cannot cause merge conflicts. The shared engineTests and windowTests
// arrays in feature-batch-ci-targets.mjs stay sorted; namedTests() checks those.
export function namedListProblems({ changedFiles, listText, listPath }) {
  const wanted = changedFiles.filter((f) => ENGINE_OR_WINDOW_TEST.test(f)).map((f) => f.replace(/^(engine|window)\//, '$1:')).sort();
  if (wanted.length === 0) return [];
  if (listText == null) {
    return [problem('named-tests', `no named-test list for ${wanted.length} changed test file(s)`, `create ${listPath} with these lines: ${wanted.join(' ')}`)];
  }
  const have = listText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const missing = wanted.filter((w) => !have.includes(w));
  return missing.map((w) => problem('named-tests', `${listPath} lacks ${w}`, `add the line ${w}`));
}

export function uiProofProblems({ changedFiles, body }) {
  const result = checkUIProof(changedFiles, body ?? '');
  if (result.exitCode === 0) return [];
  return [problem('ui-proof', result.message.split('\n')[0], 'add a screenshot image or link to the body, or the line "No visible change: <reason>"')];
}

export function proofImageProblems(files) {
  const added = (files ?? []).filter((f) => f.status === 'added' || f.status === 'renamed').map((f) => f.filename);
  const result = checkCommittedProofImages(added);
  if (result.exitCode === 0) return [];
  return [problem('proof-images', result.message.split('\n')[0], 'remove the committed screenshots; attach them to the PR description, or (bots) push them to the evidence branch under verifier/<PR number>/, and link the raw URLs in the body')];
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
export function gateFileProblems({
  changedFiles, body, headSha, protectedPaths,
  commits, files, baseRef, request, prNumber, baselineGrew, repoDir,
}) {
  const review = evaluateGateChangeReview({
    changedFiles, body: body ?? '', headSha, protectedPaths,
    commits, files, baseRef, request, prNumber, baselineGrew, repoDir,
  });
  if (review.ok) return [];
  return [problem(
    'gate-files',
    `protected gate file(s) changed without a reviewer marker for this head: ${review.protectedFiles.join(', ')}`,
    'this change needs a reviewer verdict comment ("[Full] Verifier:" or "[Full] Gardener:", or the [Mobile] form) with review-verdict: MERGE <full head sha> and gate-change-reviewed: <same sha>. A PR body line counts for nothing, and the PR author bot never posts the verdict',
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
// The title match ignores case, so "Fix(settings): ..." is held to the rule too.
const PRIOR_ART_TITLE = /^(fix|perf|refactor)(\([^)]*\))?!?:/i;
// "Prior art: x", "- Prior art: x", "**Prior art:** x" or "**Prior art**: x".
const PRIOR_ART_LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?prior art(?:\*\*|__)?\s*:(?:\*\*|__)?(.*)$/i;
// A "## Prior art" heading; its section is the lines up to the next heading.
const PRIOR_ART_HEADING = /^\s{0,3}#{1,6}\s+(?:\*\*|__)?prior art(?:\*\*|__)?\s*:?\s*#*\s*$/i;
const HEADING = /^\s{0,3}#{1,6}\s/;
// An unfilled template slot such as "<what you checked>". Autolinks like <https://...> are real sources.
const PLACEHOLDER = /<(?![a-z][a-z0-9+.-]*:\/\/)[^<>\n]*>/i;
const EMPTY_ANSWER = /^(?:n\/?a|none|nothing|-+|tbd|todo)[.!]?$/i;
const PRIOR_ART_FIX = 'add "Prior art: <what you checked>" (a line, a bold label, or a "## Prior art" section) naming the upstream project, peer agents or old code you checked, or "Prior art: none found: <what you checked>"';

// The text a body gives for prior art: the label's own text, or the lines under it or under the heading when that is empty.
function priorArtCandidates(body) {
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const candidates = [];
  lines.forEach((line, index) => {
    const label = PRIOR_ART_LABEL.exec(line);
    if (label && label[1].trim()) {
      candidates.push(label[1]);
      return;
    }
    if (!label && !PRIOR_ART_HEADING.test(line)) return;
    const following = [];
    for (const next of lines.slice(index + 1)) {
      if (HEADING.test(next)) break;
      // A bare label's source sits on the lines right after it; a blank line after them ends it.
      if (label && !next.trim() && following.length) break;
      following.push(next);
    }
    candidates.push(following.join('\n'));
  });
  return candidates;
}

function cleanPriorArt(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

// Why a candidate is not an answer, or null when it is one.
function priorArtGap(candidate) {
  const text = cleanPriorArt(candidate);
  if (!text) return 'is empty';
  if (PLACEHOLDER.test(text)) return 'still has the template placeholder';
  const answer = text.replace(/^prior art\s*:\s*/i, '');
  if (EMPTY_ANSWER.test(answer)) return 'says only "' + answer + '" and names nothing checked';
  if (/^none found\b/i.test(answer) && !/^none found\s*:\s*\S/i.test(answer)) return 'says "none found" without what was checked';
  return null;
}

export function priorArtProblems({ title, body }) {
  if (!PRIOR_ART_TITLE.test((title ?? '').trim())) {
    return [];
  }
  const candidates = priorArtCandidates(body ?? '');
  if (!candidates.length) {
    return [problem('prior-art', 'title "' + title + '" needs a "Prior art:" line or section in the body and has none', PRIOR_ART_FIX)];
  }
  const gaps = candidates.map(priorArtGap);
  if (gaps.some((gap) => gap === null)) {
    return [];
  }
  return [problem('prior-art', 'the Prior art entry ' + gaps[0], PRIOR_ART_FIX)];
}

// Generic machine-detail patterns. /home/<name>/ skips fixture-like names; *.local skips
// file names such as .env.local or settings.local.json (a dot, slash or word follows or precedes).
const HOME_PATH = /\/home\/([A-Za-z0-9._-]+)\//g;
const FIXTURE_HOME_NAMES = new Set(['user', 'username', 'runner', 'ubuntu', 'node', 'example', 'test', 'tester', 'me', 'ci', 'name', 'someone', 'alice', 'bob']);
const LOCAL_HOSTNAME = /(?<![\w./-])[A-Za-z][A-Za-z0-9-]*\.local\b(?![.\w/-])/i;

export function personalHomePath(text) {
  for (const m of String(text).matchAll(HOME_PATH)) {
    if (!FIXTURE_HOME_NAMES.has(m[1].toLowerCase())) return true;
  }
  return false;
}

// Private names (machine names, hostnames, account handles) come from the environment, never from the repo:
// BRANCH_PRIVATE_NAME_DENYLIST is a comma-separated list, set locally or as a CI secret.
export function privateNameDenylist(env = process.env) {
  return String(env.BRANCH_PRIVATE_NAME_DENYLIST ?? '')
    .split(',').map((n) => n.trim()).filter((n) => n.length >= 3);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deniedNameIn(text, denylist) {
  const value = String(text);
  return denylist.some((name) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i').test(value));
}

// In a path, a directory named like a host (<host>.local/) counts; a file name ending in .local does not.
function hostDirectoryInPath(file) {
  return String(file).split('/').slice(0, -1).some((part) => /^[A-Za-z][A-Za-z0-9-]*\.local$/i.test(part));
}

function genericMachineDetail(text) {
  return PERSONAL_PATTERNS.some((p) => p.test(text)) || personalHomePath(text) || LOCAL_HOSTNAME.test(text);
}

// Added lines and changed file paths. Test files are exempt from the generic patterns (they carry
// synthetic fixtures) but never from the private denylist, whose names must not appear anywhere.
// The problem text never repeats the matched name, so a CI log cannot leak it.
// The branch name lands in main's history through merge commits, so it is scanned as well.
export function branchNameProblems(branch, denylist = privateNameDenylist()) {
  if (!branch || branch === 'HEAD') return [];
  if (!genericMachineDetail(branch) && !/[A-Za-z][A-Za-z0-9-]*\.local(?![A-Za-z0-9.])/i.test(branch) && !deniedNameIn(branch, denylist)) return [];
  return [problem('personal-info', 'the branch name contains a personal path, hostname or private name', 'push the work to a new branch with a generic name')];
}

export function personalInfoProblems(addedLines, { changedFiles = [], denylist = privateNameDenylist(), branch = null } = {}) {
  const lineProblems = addedLines.filter((l) => (
    (!FIXTURE_FILE.test(l.file) && genericMachineDetail(l.text)) || deniedNameIn(l.text, denylist)
  )).map((l) => (
    problem('personal-info', `${l.file}:${l.line} contains a personal path, email, hostname or private name`, 'replace it with a placeholder or remove it')
  ));
  const pathProblems = [...new Set(changedFiles)].filter((f) => genericMachineDetail(f) || hostDirectoryInPath(f) || deniedNameIn(f, denylist)).map((f) => (
    problem('personal-info', `changed file path ${f} contains a personal path, hostname or private name`, 'rename the file to a generic name')
  ));
  return [...branchNameProblems(branch, denylist), ...pathProblems, ...lineProblems];
}

// Bodies are public prose, not test fixtures. Scan every domain and Markdown
// context, but retain the GitHub noreply identity exemption used by the gates.
export function bodyEmailProblems(body) {
  const addresses = body.match(/[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g) ?? [];
  if (addresses.every((address) => address.toLowerCase().endsWith(ALLOWED_SUFFIX))) return [];
  return [problem(
    'body-email',
    'PR body contains an email address',
    'remove the address or replace it with a GitHub handle; only GitHub noreply identities are exempt',
  )];
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
    ...selfCheckProblems({ branch: input.branch, headSha: input.headSha, body, repoDir: input.repoDir }),
    ...namedListProblems({ changedFiles, listText: input.listText ?? null, listPath: input.listPath }),
    ...priorArtProblems({ title: input.title, body }),
    ...uiProofProblems({ changedFiles, body }),
    ...proofImageProblems(input.files),
    ...windowCleanProblems(input.windowResult),
    ...shardProblems(input.shardResult),
    // Gate files are not a preflight problem: the reviewer's verdict comment satisfies them after review,
    // and merge-gate-trusted checks that comment (AGENTS.md rule 12). The PR body never counts.
    ...desktopCoverageProblems({ files: input.files ?? [], desktopWorkflow: input.desktopWorkflow ?? null }),
    ...personalInfoProblems(input.addedLines ?? [], { changedFiles, denylist: input.denylist ?? privateNameDenylist(), branch: input.branch }),
    ...bodyEmailProblems(body),
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
    repoDir: cwd,
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

export function inputFromApi({
  headBranch, headSha, files, commits, listText, desktopWorkflow = null, title = '',
  baseRef = null, request, prNumber,
} = {}) {
  return {
    branch: headBranch,
    headSha,
    title,
    files,
    desktopWorkflow,
    dirtyCount: 0,
    commits: commits.map(commitFromApi),
    prCommits: commits,
    changedFiles: changedFilesFromPrFiles(files),
    addedLines: files.flatMap((f) => addedLinesFromPatch(f.filename, f.patch)),
    unverifiedFiles: unverifiedFileNames(files),
    listPath: namedListPathFor(headBranch),
    listText: listText ?? null,
    windowResult: null,
    shardResult: null,
    baseRef,
    request,
    prNumber,
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
  const headBranch = env.HEAD_BRANCH || env.GITHUB_HEAD_REF;
  if (!repo || !prNumber || !token || !headSha || !headBranch) {
    throw new Error('CI mode needs REPO, PR_NUMBER, GITHUB_TOKEN, HEAD_SHA and HEAD_BRANCH');
  }
  // The live title and body from the API: the event payload can predate an edit, so CI never reads them from there.
  const pr = ghApi(repo, token, `pulls/${prNumber}`);
  const body = typeof pr?.body === 'string' ? pr.body : '';
  const title = typeof pr?.title === 'string' ? pr.title : '';
  const baseRef = typeof pr?.base?.ref === 'string' && pr.base.ref ? pr.base.ref : null;
  const request = (requestPath, options) => ghApi(repo, token, requestPath, options);
  const files = fetchPrFiles(repo, prNumber, token);
  const commits = fetchPrCommitsWithApi({ repo, prNumber, token });
  const namedList = namedListPathFor(headBranch);
  const desktop = '.github/workflows/desktop-checks.yml';
  const heads = fetchFileTextsBatch(repo, headSha, token, [namedList, desktop]);
  return {
    ...inputFromApi({
      headBranch, headSha, files, commits, listText: heads[namedList],
      desktopWorkflow: heads[desktop], title, baseRef, request, prNumber,
    }),
    body,
  };
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
    const problems = runPreflight({ ...input, cloudAgent: false, repoDir: cwd });
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
