import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  additionFor,
  changedTestPaths,
  coverageTargets,
  uncoveredTests,
  workflowHasPullRequestTrigger,
} from './changed-test-coverage.mjs';
import { checkMergeCommands, docsToCheck } from './check-merge-command.mjs';
import { checkUIProof } from './check-ui-proof.mjs';
import {
  DEFAULT_WAIT_BUDGET_SECONDS,
  GH_API_MAX_BUFFER,
  execGhApi,
  fetchGitHubRateLimit,
  ghApiArgs,
  isRateLimitError as rateLimitIsRateLimitError,
  pollIntervalSeconds,
  withRateLimitRetry,
} from './merge-gate-rate-limit.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TRUSTED_JOB = 'merge-gate-trusted';
export const TRUSTED_WORKFLOW_PATH = '.github/workflows/merge-gate-trusted.yml';
export const HANDOFF_WORKFLOW_PATH = '.github/workflows/engine-handoff-checks.yml';
export const TRUSTED_CHECKOUT_REF = '${{ github.event.repository.default_branch }}';
export const REQUIRED_JOBS = ['merge-gate', 'Analyze (actions)'];
export const PASS_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);
export const COMMENT_JOB_NAME = 'comment';
export const VISUAL_TOUR_WORKFLOW_PATH = '.github/workflows/visual-tour.yml';
export const TIMEOUT_RERUN_LINE = 're-run merge-gate, do not merge main';
export const GATE_SCRIPTS = [
  'scripts/merge-gate-trusted.mjs',
  'scripts/merge-gate-trusted.test.mjs',
  'scripts/changed-test-coverage.mjs',
  'scripts/changed-test-coverage.test.mjs',
  'scripts/check-merge-command.mjs',
  'scripts/check-merge-command.test.mjs',
  'scripts/check-ui-proof.mjs',
  'scripts/check-ui-proof.test.mjs',
  'scripts/feature-batch-ci-targets.mjs',
  'scripts/feature-slice-ci-targets.mjs',
  'scripts/priority-capabilities-ci-targets.mjs',
  'scripts/merge-gate-rate-limit.mjs',
  'scripts/merge-gate-rate-limit.test.mjs',
];
export const PACKAGE_JSON_FILES = [
  'package.json',
  'engine/package.json',
  'window/package.json',
  'desktop/package.json',
];

const SKIP_WORKFLOWS = new Set([
  TRUSTED_WORKFLOW_PATH,
  '.github/workflows/merge-gate-recheck.yml',
]);

export function trustedCheckoutRef(event) {
  const defaultBranch = event?.repository?.default_branch;
  if (typeof defaultBranch !== 'string' || defaultBranch.length === 0) {
    throw new Error('trusted checkout requires repository.default_branch');
  }
  return defaultBranch;
}

export function parseTrustedWorkflowPolicy(yaml) {
  const checkoutRef = yaml.match(/^\s+ref:\s*(.+)$/m)?.[1].trim() ?? null;
  return {
    checkoutRef,
    persistCredentialsFalse: /^\s+persist-credentials:\s*false\s*$/m.test(yaml),
    checksOutDefaultBranch: checkoutRef === TRUSTED_CHECKOUT_REF,
    checksOutPrBaseSha: /^\s+ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}\s*$/m.test(yaml),
    checksOutPrHead: /^\s+ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)\s*\}\}\s*$/m.test(yaml),
  };
}

export function nameStatusFromPrFiles(files) {
  return files.flatMap((file) => {
    const name = file.filename;
    if (file.status === 'removed') return [`D\t${name}`];
    if (file.status === 'renamed') return [`A\t${name}`];
    if (file.status === 'added') return [`A\t${name}`];
    return [`M\t${name}`];
  }).join('\n');
}

export function newestChecksByIdentity(checkRuns, workflowsByCheckId = {}, { sha, prNumber, baseRef } = {}) {
  const newest = new Map();
  for (const run of checkRuns) {
    const workflow = lookupWorkflow(workflowsByCheckId, run.id);
    // Only this PR's pull_request runs can supersede each other on reopen.
    const prs = workflow?.pullRequests ?? [];
    const bound = run.app?.id != null && workflow?.path && workflow.event === 'pull_request'
      && sha && workflow.headSha === sha
      && workflow.checkSuiteId != null && run.check_suite?.id != null
      && Number(run.check_suite.id) === Number(workflow.checkSuiteId)
      && prNumber && prs.some((pr) => Number(pr.number) === Number(prNumber))
      && baseRef && prs.every((pr) => pr.base === baseRef);
    const key = bound
      ? JSON.stringify([run.app.id, workflow.path, run.name]) : Symbol();
    const previous = newest.get(key);
    // IDs increase with check creation, including queued checks without started_at.
    if (!previous || Number(run.id) > Number(previous.id)) newest.set(key, run);
  }
  return [...newest.values()];
}

export function isVisualTourWorkflow(workflow) {
  return Boolean(workflow) && workflow.path === VISUAL_TOUR_WORKFLOW_PATH;
}

export function isSkippableVisualTourComment(run, workflow) {
  return run?.name === COMMENT_JOB_NAME && isVisualTourWorkflow(workflow);
}

export function evaluateOtherChecks(checkRuns, workflowsByCheckId = {}, ignoreName = TRUSTED_JOB, context = {}) {
  const others = newestChecksByIdentity(checkRuns, workflowsByCheckId, context).filter((run) => {
    if (run.name === ignoreName) return false;
    return !isSkippableVisualTourComment(run, lookupWorkflow(workflowsByCheckId, run.id));
  });
  const pending = others.filter((run) => run.status !== 'completed');
  const failed = others.filter((run) =>
    run.status === 'completed' && !PASS_CONCLUSIONS.has(run.conclusion));
  return { others, pending, failed };
}

export function lookupWorkflow(workflowsByCheckId, checkRunId) {
  return workflowsByCheckId[checkRunId] ?? workflowsByCheckId[String(checkRunId)] ?? null;
}

export function actionsRunIdFromCheckRun(checkRun) {
  const fromUrl = String(checkRun?.details_url ?? checkRun?.html_url ?? '').match(/\/actions\/runs\/(\d+)/);
  return fromUrl ? Number(fromUrl[1]) : null;
}

export function findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
  jobName = TRUSTED_JOB,
  allowedWorkflowPath = TRUSTED_WORKFLOW_PATH,
  allowedRunId,
  allowedEvent = 'pull_request_target',
} = {}) {
  const currentId = allowedRunId == null || allowedRunId === '' ? null : Number(allowedRunId);
  return checkRuns.filter((run) => run.name === jobName).filter((run) => {
    const urlRunId = actionsRunIdFromCheckRun(run);
    const workflow = lookupWorkflow(workflowsByCheckId, run.id);
    if (currentId != null && Number.isFinite(currentId) && urlRunId === currentId) {
      // API outages are pending, never self-attributed or accepted as genuine.
      if (!workflow) return false;
      if (workflow.id == null || workflow.id === ''
        || Number(workflow.id) !== currentId) return true;
      if (workflow.path !== allowedWorkflowPath || workflow.event !== allowedEvent) return true;
      if (workflow.checkSuiteId == null || run.check_suite?.id == null
        || Number(run.check_suite.id) !== Number(workflow.checkSuiteId)) return true;
      return false;
    }
    // Sibling or earlier runs of this workflow on pull_request_target are
    // genuine. GitHub often omits pull_requests and can disagree on suite or
    // head SHA for that event, which previously failed a second legitimate run.
    if (!workflow || workflow.id == null || workflow.id === '') return true;
    if (workflow.path !== allowedWorkflowPath) return true;
    if (workflow.event !== allowedEvent) return true;
    return false;
  });
}

export function pathFilterMatches(file, pattern) {
  if (file === pattern) return true;
  try {
    return path.matchesGlob(file, pattern);
  } catch {
    return false;
  }
}

export function workflowAppliesToChanges(changedFiles, pullRequestPaths) {
  if (!pullRequestPaths) return true;
  return changedFiles.some((file) =>
    pullRequestPaths.some((pattern) => pathFilterMatches(file, pattern)));
}

export function isPassingHandoffE2e(run) {
  return run.status === 'completed'
    && run.conclusion === 'success'
    && /^Real-engine handoff /.test(run.name);
}

export function parsePullRequestTrigger(yaml) {
  const lines = yaml.split(/\r?\n/);
  let inOn = false;
  let onIndent = 0;
  let inPullRequest = false;
  let pullIndent = 0;
  let inPaths = false;
  let pathsIndent = 0;
  let sawPullRequest = false;
  const paths = [];

  for (const line of lines) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    if (!inOn) {
      if (trimmed === 'on:') {
        inOn = true;
        onIndent = indent;
      }
      continue;
    }

    if (indent <= onIndent && !trimmed.startsWith('#')) {
      break;
    }

    if (!inPullRequest) {
      if (/^pull_request:/.test(trimmed)) {
        sawPullRequest = true;
        inPullRequest = true;
        pullIndent = indent;
        if (!trimmed.endsWith(':') && trimmed !== 'pull_request:') {
          return { enabled: true, paths: null };
        }
      }
      continue;
    }

    if (indent <= pullIndent) {
      inPullRequest = false;
      inPaths = false;
      if (/^pull_request:/.test(trimmed)) {
        inPullRequest = true;
        pullIndent = indent;
      }
      continue;
    }

    if (!inPaths) {
      if (trimmed === 'paths:' || trimmed.startsWith('paths:')) {
        const inline = trimmed.slice('paths:'.length).trim();
        if (inline.startsWith('[')) {
          const items = inline.replace(/^\[/, '').replace(/\]$/, '')
            .split(',')
            .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
          paths.push(...items);
        } else {
          inPaths = true;
          pathsIndent = indent;
        }
      }
      continue;
    }

    if (indent <= pathsIndent) {
      inPaths = false;
      continue;
    }

    const item = trimmed.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
    if (item) paths.push(item);
  }

  if (!sawPullRequest) return { enabled: false, paths: null };
  return { enabled: true, paths: paths.length ? paths : null };
}

export function listCoreWorkflows(workflowDir) {
  const workflows = [];
  for (const name of readdirSync(workflowDir).sort()) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const filePath = `.github/workflows/${name}`;
    if (SKIP_WORKFLOWS.has(filePath)) continue;
    const yaml = readFileSync(path.join(workflowDir, name), 'utf8');
    const trigger = parsePullRequestTrigger(yaml);
    if (!trigger.enabled) continue;
    workflows.push({ path: filePath, pullRequestPaths: trigger.paths });
  }
  return workflows;
}

export function missingCoreWorkflows({
  checkRuns,
  workflowsByCheckId,
  changedFiles,
  coreWorkflows,
  requiredJobs = REQUIRED_JOBS,
  sha,
  prNumber,
  baseRef,
}) {
  checkRuns = newestChecksByIdentity(checkRuns, workflowsByCheckId, { sha, prNumber, baseRef });
  const missing = [];

  for (const job of requiredJobs) {
    const runs = checkRuns.filter((item) => item.name === job);
    if (!runs.length) missing.push(`${job} (not present)`);
    for (const run of runs) {
      if (run.status === 'completed' && run.conclusion === 'success') continue;
      missing.push(`${job} (status: ${run.status}, conclusion: ${run.conclusion})`);
    }
  }

  for (const workflow of coreWorkflows) {
    if (!workflowAppliesToChanges(changedFiles, workflow.pullRequestPaths)) continue;
    if (workflow.path === '.github/workflows/merge-gate.yml'
      && checkRuns.some((run) => run.name === 'merge-gate')) {
      continue;
    }
    const runs = checkRuns.filter((run) => lookupWorkflow(workflowsByCheckId, run.id)?.path === workflow.path);
    if (!runs.length) missing.push(`${workflow.path} (path filter matched, no check run)`);
    else if (workflow.path === HANDOFF_WORKFLOW_PATH && !runs.some(isPassingHandoffE2e)) {
      missing.push(`${workflow.path} (hand-over paths changed, no passing real-engine handoff run)`);
    }
  }

  return missing;
}

export function evaluateTrustedGate({
  checkRuns,
  workflowsByCheckId,
  changedFiles,
  coreWorkflows,
  currentRunId,
  sha,
  prNumber,
  baseRef,
}) {
  const context = { sha, prNumber, baseRef };
  const { others, pending, failed } = evaluateOtherChecks(checkRuns, workflowsByCheckId, TRUSTED_JOB, context);
  const unresolvedCurrent = checkRuns.filter((run) => run.name === TRUSTED_JOB
    && currentRunId != null && currentRunId !== '' && Number.isFinite(Number(currentRunId))
    && actionsRunIdFromCheckRun(run) === Number(currentRunId)
    && !lookupWorkflow(workflowsByCheckId, run.id));
  const missingAnalyze = !others.some((run) => run.name === 'Analyze (actions)');
  const foreignTrusted = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: currentRunId,
    sha,
    prNumber,
    baseRef,
  });
  const missingCore = missingCoreWorkflows({
    checkRuns,
    workflowsByCheckId,
    changedFiles,
    coreWorkflows,
    ...context,
  });

  const errors = [];
  if (failed.length) {
    errors.push(`Failed checks: ${failed.map((run) => `${run.name}: ${run.conclusion}`).join(', ')}`);
  }
  if (foreignTrusted.length) {
    const details = foreignTrusted.map((run) => {
      const workflow = lookupWorkflow(workflowsByCheckId, run.id);
      if (!workflow || workflow.id == null || workflow.id === '') {
        return `${run.name} check ${run.id} (unattributed)`;
      }
      return `${run.name} from ${workflow.path ?? 'unknown path'} run ${workflow.id} event ${workflow.event ?? 'unknown'}`;
    });
    errors.push(`Forged or extra ${TRUSTED_JOB} check(s): ${details.join(', ')}`);
  }
  if (missingCore.length) {
    errors.push(`Missing or failed core workflows: ${missingCore.join(', ')}`);
  }

  return {
    others,
    pending,
    failed,
    foreignTrusted,
    missingCore,
    unresolvedCurrent,
    ready: pending.length === 0 && unresolvedCurrent.length === 0 && !missingAnalyze,
    ok: errors.length === 0 && pending.length === 0 && unresolvedCurrent.length === 0 && !missingAnalyze,
    errors,
  };
}

export function summarizeGateFileChanges(changedFiles) {
  return [...new Set(changedFiles)].filter((file) =>
    file.startsWith('.github/workflows/')
    || GATE_SCRIPTS.includes(file)
    || PACKAGE_JSON_FILES.includes(file)).sort();
}

export function formatGateChangeSummary(changedFiles) {
  const listed = summarizeGateFileChanges(changedFiles);
  const lines = ['## Merge-gate file changes', ''];
  if (!listed.length) {
    lines.push('No `.github/workflows/**`, gate `scripts/`, or `package.json` files changed.');
    return lines.join('\n');
  }
  lines.push('This pull request changes files the merge gates use. Review them before merging:');
  lines.push('');
  for (const file of listed) lines.push(`- \`${file}\``);
  return lines.join('\n');
}

export function parseNamedTestList(text, source = 'scripts/feature-batch-ci-named/<list>.txt') {
  const files = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(engine|window):(.+)$/.exec(line);
    if (!match) {
      throw new Error(`${source}: expected engine:<file> or window:<file>, got "${line}"`);
    }
    files.push({ lane: match[1], file: match[2].trim() });
  }
  return files;
}

export function coverageFromPrFiles(files, desktopWorkflow, extraNamed = [], handoffWorkflow = '', handoffConfig = '') {
  const changed = changedTestPaths(nameStatusFromPrFiles(files));
  const covered = coverageTargets(desktopWorkflow, handoffWorkflow, handoffConfig);
  for (const entry of extraNamed) covered.add(`${entry.lane}/${entry.file}`);
  const uncovered = uncoveredTests(changed, covered);
  return { changed, uncovered };
}

export function isRateLimitError(error) {
  return rateLimitIsRateLimitError(error);
  const text = `${error?.stderr ?? ''}\n${error?.message ?? ''}\n${error?.stdout ?? ''}`;
  return /rate limit exceeded/i.test(text);
}

export function ghApi(repo, token, requestPath, { paginate = false, retries = 6 } = {}) {
  return ghApiWithRetry(repo, token, requestPath, { paginate, retries });
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
      sleepSeconds(wait);
    }
  }
  return null;
}

export function ghApiWithRetry(repo, token, requestPath, {
  paginate = false,
  retries = Number.POSITIVE_INFINITY,
  sleep = sleepSeconds,
  now = Date.now,
  fetchRateLimit,
  startedAt,
  budgetSeconds,
  random,
  log = console.log,
  jq,
  maxBuffer = GH_API_MAX_BUFFER,
} = {}) {
  const includeHeaders = !paginate && !jq;
  const args = ghApiArgs(`repos/${repo}/${requestPath}`, { paginate, includeHeaders, jq });
  return withRateLimitRetry(() => {
    const parsed = execGhApi(args, { token, includeHeaders, maxBuffer });
    return parsed.json;
  }, {
    sleep,
    now,
    fetchRateLimit: fetchRateLimit ?? (() => fetchGitHubRateLimit(token)),
    startedAt,
    budgetSeconds: budgetSeconds ?? Number(process.env.MERGE_GATE_WAIT_SECONDS ?? DEFAULT_WAIT_BUDGET_SECONDS),
    maxRetries: retries,
    random,
    log,
  });
}

export function normalizeCheckRunPages(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) {
    if (payload.length === 0) return payload;
    if (payload.every((item) => item && (Array.isArray(item.check_runs) || Number.isInteger(item.total_count)))) {
      return payload;
    }
    if (payload.every((item) => item && typeof item.name === 'string')) {
      return [{ check_runs: payload, total_count: payload.length }];
    }
    return payload;
  }
  if (payload.check_runs || Number.isInteger(payload.total_count)) return [payload];
  throw new Error('expected check-runs pages, { check_runs, total_count }, or a check-run array');
}

export function mergeCheckRunPages(payload) {
  const pages = normalizeCheckRunPages(payload);
  const checkRuns = pages.flatMap((page) => {
    if (Array.isArray(page)) return page;
    return page?.check_runs ?? [];
  });
  const reported = pages
    .map((page) => (page && !Array.isArray(page) ? page.total_count : null))
    .find((value) => Number.isInteger(value));
  const totalCount = reported ?? checkRuns.length;
  return {
    checkRuns,
    totalCount,
    complete: checkRuns.length >= totalCount,
  };
}

export function fetchCheckRuns(repo, sha, token, api = ghApi) {
  const pages = [];
  for (let page = 1; ; page += 1) {
    const payload = api(repo, token, `commits/${sha}/check-runs?per_page=100&page=${page}`);
    pages.push(payload);
    const merged = mergeCheckRunPages(pages);
    if (merged.complete) return merged.checkRuns;
    const pageLen = Array.isArray(payload?.check_runs) ? payload.check_runs.length : 0;
    if (pageLen === 0) return merged.checkRuns;
  }
}

export function formatTimeoutMessage(pending, { missingAnalyze = false } = {}) {
  const names = [...new Set((pending ?? []).map((run) => run.name).filter(Boolean))];
  if (missingAnalyze && !names.includes('Analyze (actions)')) names.push('Analyze (actions)');
  names.sort();
  const waitingOn = names.length ? names.join(', ') : '(no named pending check)';
  return `Timed out waiting for: ${waitingOn}\n${TIMEOUT_RERUN_LINE}`;
}

export function fetchPrFiles(repo, prNumber, token) {
  const payload = ghApi(repo, token, `pulls/${prNumber}/files?per_page=100`, { paginate: true });
  return Array.isArray(payload) ? payload : [];
}

export function fetchPrBody(repo, prNumber, token) {
  const payload = ghApi(repo, token, `pulls/${prNumber}`);
  return typeof payload?.body === 'string' ? payload.body : '';
}

export function runUiProofFromPr(files, prBody) {
  const result = checkUIProof(files.map((file) => file.filename ?? file), prBody ?? '');
  if (result.exitCode) console.error(result.message);
  else console.log(result.message);
  return result.exitCode === 0;
}

export function fetchFileText(repo, sha, token, filePath) {
  try {
    const payload = ghApi(repo, token, `contents/${filePath}?ref=${sha}`);
    if (!payload?.content) return null;
    return Buffer.from(payload.content, payload.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
  } catch {
    return null;
  }
}

export function workflowFromActionsRun(run) {
  if (!run) return null;
  return {
    path: run.path ?? null,
    name: run.name ?? null,
    id: run.id ?? null,
    event: run.event ?? null,
    checkSuiteId: run.check_suite_id ?? null,
    headSha: run.head_sha ?? null,
    pullRequests: (run.pull_requests ?? []).map((pr) => ({ number: pr.number, base: pr.base?.ref })),
  };
}

export function resolveWorkflowForCheckRun(repo, token, checkRun) {
  const fromUrl = actionsRunIdFromCheckRun(checkRun);
  if (fromUrl != null) {
    return workflowFromActionsRun(ghApi(repo, token, `actions/runs/${fromUrl}`));
  }
  const suiteId = checkRun.check_suite?.id;
  if (!suiteId) return null;
  const payload = ghApi(repo, token, `actions/runs?check_suite_id=${suiteId}&per_page=1`);
  return workflowFromActionsRun(payload?.workflow_runs?.[0]);
}

export function resolveWorkflowsForCheckRuns(repo, token, checkRuns, {
  attributionCache = new Map(),
  resolveWorkflow = resolveWorkflowForCheckRun,
} = {}) {
  const workflowsByCheckId = {};
  for (const run of checkRuns) {
    if (attributionCache.has(run.id)) {
      workflowsByCheckId[run.id] = attributionCache.get(run.id);
      continue;
    }
    try {
      const workflow = resolveWorkflow(repo, token, run);
      if (workflow) {
        workflowsByCheckId[run.id] = workflow;
        // Attribution is immutable for a check ID; status/conclusion still come from each poll.
        attributionCache.set(run.id, workflow);
      }
    } catch {
      // Fail closed later if a trusted-job name cannot be attributed.
    }
  }
  return workflowsByCheckId;
}

function sleepSeconds(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}

function writeSummary(text) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) writeFileSync(summaryFile, `${text}\n`, { flag: 'a' });
  console.log(text);
}

export function fetchNamedTestLists(repo, sha, token) {
  let entries;
  try {
    entries = ghApi(repo, token, `contents/scripts/feature-batch-ci-named?ref=${sha}`);
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const extra = [];
  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name?.endsWith('.txt') || entry.name === 'README.txt') continue;
    const text = fetchFileText(repo, sha, token, entry.path);
    if (text == null) continue;
    extra.push(...parseNamedTestList(text, entry.path));
  }
  return extra;
}

export function resolvePrDesktopWorkflow(fetched) {
  return typeof fetched === 'string' && fetched !== '' ? fetched : null;
}

export function trustedDesktopWorkflow(fetched) {
  const workflow = resolvePrDesktopWorkflow(fetched);
  if (workflow == null) return null;
  return workflowHasPullRequestTrigger(workflow) ? workflow : '';
}

function runCoverage(files, extraNamed, repo, sha, token) {
  const fetched = repo && sha && token
    ? fetchFileText(repo, sha, token, '.github/workflows/desktop-checks.yml')
    : null;
  const workflow = trustedDesktopWorkflow(fetched);
  if (workflow == null) {
    console.error('Could not read pull request .github/workflows/desktop-checks.yml; failing closed.');
    return false;
  }
  const handoffWorkflow = readFileSync(path.join(root, HANDOFF_WORKFLOW_PATH), 'utf8');
  const handoffConfig = readFileSync(path.join(root, 'engine/test/vitest/vitest.desktop-handoff.config.ts'), 'utf8');
  const { changed, uncovered } = coverageFromPrFiles(files, workflow, extraNamed, handoffWorkflow, handoffConfig);
  if (uncovered.length) {
    for (const file of uncovered) {
      console.error(`Uncovered changed test: ${file}\n  Add: ${additionFor(file)}`);
    }
    return false;
  }
  console.log(`Changed test coverage: ${changed.length} added/modified test file(s) covered.`);
  return true;
}

function runMergeCommandCheck(repo, sha, token) {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-gate-trusted-docs-'));
  for (const doc of docsToCheck) {
    const text = fetchFileText(repo, sha, token, doc);
    if (text == null) continue;
    const dest = path.join(dir, doc);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  return checkMergeCommands(dir, docsToCheck);
}

export function pollTrustedGate({
  repo, sha, token, changedFiles, coreWorkflows, currentRunId, prNumber, baseRef,
  maxAttempts = 64, pollSeconds = 30,
  waitBudgetSeconds = DEFAULT_WAIT_BUDGET_SECONDS, startedAt,
}, {
  fetchChecks = fetchCheckRuns,
  resolveWorkflows = resolveWorkflowsForCheckRuns,
  sleep = sleepSeconds,
  log = console.log,
  error = console.error,
  now = Date.now,
} = {}) {
  return pollTrustedGateWithBudget({
    repo, sha, token, changedFiles, coreWorkflows, currentRunId, prNumber, baseRef,
    maxAttempts, pollSeconds, waitBudgetSeconds, startedAt,
  }, { fetchChecks, resolveWorkflows, sleep, log, error, now });
  const attributionCache = new Map();
  let last = { pending: [], others: [] };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const checkRuns = fetchChecks(repo, sha, token);
    const workflowsByCheckId = resolveWorkflows(repo, token, checkRuns, { attributionCache });
    const result = evaluateTrustedGate({
      checkRuns, workflowsByCheckId, changedFiles, coreWorkflows, currentRunId,
      sha, prNumber, baseRef,
    });
    last = result;

    if (result.failed.length || result.foreignTrusted.length) {
      for (const message of result.errors) error(message);
      return 1;
    }
    if (result.ready) {
      if (result.missingCore.length) {
        for (const message of result.errors) error(message);
        return 1;
      }
      log(`All ${result.others.length} other checks passed.`);
      return 0;
    }
    log(`Waiting for checks (running: ${result.pending.length}, unresolved current claims: ${result.unresolvedCurrent.length}, including required Analyze)…`);
    if (attempt < maxAttempts) sleep(pollSeconds);
  }

  const analyze = (last.others ?? []).find((run) => run.name === 'Analyze (actions)');
  error(formatTimeoutMessage(last.pending, { missingAnalyze: !analyze }));
  return 1;
}

export function pollTrustedGateWithBudget({
  repo, sha, token, changedFiles, coreWorkflows, currentRunId, prNumber, baseRef,
  maxAttempts = 64, pollSeconds, waitBudgetSeconds = DEFAULT_WAIT_BUDGET_SECONDS, startedAt,
}, {
  fetchChecks = fetchCheckRuns, resolveWorkflows = resolveWorkflowsForCheckRuns,
  sleep = sleepSeconds, log = console.log, error = console.error, now = Date.now,
} = {}) {
  const attributionCache = new Map();
  let last = { pending: [], others: [] };
  const start = startedAt ?? now();
  const remaining = () => waitBudgetSeconds - (now() - start) / 1000;
  for (let attempt = 1; attempt <= maxAttempts; ) {
    if (remaining() < 1) break;
    let checkRuns;
    try {
      checkRuns = fetchChecks(repo, sha, token);
    } catch (err) {
      if (!isRateLimitError(err)) throw err;
      if (remaining() < 1) break;
      const wait = Math.min(pollSeconds ?? pollIntervalSeconds(0), remaining());
      log(`GitHub API rate limited; retrying in ${Math.ceil(wait)}s…`);
      sleep(wait);
      continue;
    }
    const unresolved = checkRuns.filter((run) => run.status !== 'completed' || !attributionCache.has(run.id));
    const workflowsByCheckId = {
      ...Object.fromEntries(attributionCache),
      ...resolveWorkflows(repo, token, unresolved, { attributionCache }),
    };
    const result = evaluateTrustedGate({
      checkRuns, workflowsByCheckId, changedFiles, coreWorkflows, currentRunId,
      sha, prNumber, baseRef,
    });
    last = result;
    if (result.failed.length || result.foreignTrusted.length) {
      for (const message of result.errors) error(message);
      return 1;
    }
    if (result.ready) {
      if (result.missingCore.length) {
        for (const message of result.errors) error(message);
        return 1;
      }
      log(`All ${result.others.length} other checks passed.`);
      return 0;
    }
    log(`Waiting for checks (running: ${result.pending.length}, unresolved current claims: ${result.unresolvedCurrent.length}, including required Analyze)…`);
    if (attempt >= maxAttempts || remaining() < 1) break;
    sleep(Math.min(pollSeconds ?? pollIntervalSeconds(attempt - 1), remaining()));
    attempt += 1;
  }

  const analyze = (last.others ?? []).find((run) => run.name === 'Analyze (actions)');
  error(formatTimeoutMessage(last.pending, { missingAnalyze: !analyze }));
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.REPO;
  const sha = process.env.SHA;
  const token = process.env.GH_TOKEN;
  const prNumber = process.env.PR_NUMBER;
  const baseRef = process.env.BASE_REF;
  const maxAttempts = Number(process.env.MERGE_GATE_MAX_ATTEMPTS ?? 64);
  const pollSeconds = Number(process.env.MERGE_GATE_POLL_SECONDS ?? 30);
  const waitBudgetSeconds = Number(process.env.MERGE_GATE_WAIT_SECONDS ?? DEFAULT_WAIT_BUDGET_SECONDS);
  const initialWait = Number(process.env.MERGE_GATE_INITIAL_WAIT ?? 30);

  if (!repo || !sha || !token || !prNumber || !baseRef) {
    console.error('Missing required environment variables: REPO, SHA, GH_TOKEN, PR_NUMBER, BASE_REF');
    process.exit(1);
  }

  const files = fetchPrFiles(repo, prNumber, token);
  const changedFiles = files.flatMap((file) => (
    file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]
  ));

  writeSummary(formatGateChangeSummary(changedFiles));

  const extraNamed = fetchNamedTestLists(repo, sha, token);
  if (!runCoverage(files, extraNamed, repo, sha, token)) process.exit(1);
  if (!runMergeCommandCheck(repo, sha, token)) {
    console.error('Merge-command check failed on the pull request documentation.');
    process.exit(1);
  }
  console.log('Merge-command check passed.');
  if (!runUiProofFromPr(files, fetchPrBody(repo, prNumber, token))) process.exit(1);

  if (initialWait > 0) sleepSeconds(initialWait);

  const coreWorkflows = listCoreWorkflows(path.join(root, '.github/workflows'));
  process.exit(pollTrustedGate({
    repo, sha, token, changedFiles, coreWorkflows,
    currentRunId: process.env.GITHUB_RUN_ID, prNumber, baseRef, maxAttempts, pollSeconds,
    waitBudgetSeconds,
  }));
}
