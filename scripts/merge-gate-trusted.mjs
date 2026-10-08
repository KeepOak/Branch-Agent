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
} from './changed-test-coverage.mjs';
import { checkMergeCommands, docsToCheck } from './check-merge-command.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TRUSTED_JOB = 'merge-gate-trusted';
export const TRUSTED_WORKFLOW_PATH = '.github/workflows/merge-gate-trusted.yml';
export const TRUSTED_CHECKOUT_REF = '${{ github.event.repository.default_branch }}';
export const REQUIRED_JOBS = ['merge-gate'];
export const PASS_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);
export const GATE_SCRIPTS = [
  'scripts/merge-gate-trusted.mjs',
  'scripts/merge-gate-trusted.test.mjs',
  'scripts/changed-test-coverage.mjs',
  'scripts/changed-test-coverage.test.mjs',
  'scripts/check-merge-command.mjs',
  'scripts/check-merge-command.test.mjs',
  'scripts/feature-batch-ci-targets.mjs',
  'scripts/feature-slice-ci-targets.mjs',
  'scripts/priority-capabilities-ci-targets.mjs',
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

export function newestChecksByName(checkRuns) {
  const newest = new Map();
  for (const run of checkRuns) {
    const previous = newest.get(run.name);
    // IDs increase with check creation, including queued checks without started_at.
    if (!previous || Number(run.id) > Number(previous.id)) newest.set(run.name, run);
  }
  return [...newest.values()];
}

export function evaluateOtherChecks(checkRuns, ignoreName = TRUSTED_JOB) {
  const others = newestChecksByName(checkRuns).filter((run) => run.name !== ignoreName);
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
  sha,
  prNumber,
  baseRef,
} = {}) {
  const currentId = allowedRunId == null || allowedRunId === '' ? null : Number(allowedRunId);
  return checkRuns.filter((run) => run.name === jobName).filter((run) => {
    const urlRunId = actionsRunIdFromCheckRun(run);
    const workflow = lookupWorkflow(workflowsByCheckId, run.id);
    if (currentId != null && Number.isFinite(currentId) && urlRunId === currentId) {
      if (!workflow) return false;
      if (workflow.id != null && workflow.id !== '' && Number(workflow.id) !== currentId) return true;
      if (workflow.path && workflow.path !== allowedWorkflowPath) return true;
      if (workflow.event && workflow.event !== allowedEvent) return true;
      return false;
    }
    if (!workflow || workflow.id == null || workflow.id === '') return true;
    if (workflow.path !== allowedWorkflowPath) return true;
    if (workflow.event !== allowedEvent) return true;
    if (workflow.checkSuiteId == null || run.check_suite?.id == null
      || Number(run.check_suite.id) !== Number(workflow.checkSuiteId)) return true;
    if (!sha || workflow.headSha !== sha) return true;
    const prs = workflow.pullRequests ?? [];
    if (!prNumber || !prs.some((pr) => Number(pr.number) === Number(prNumber))) return true;
    if (!baseRef || prs.some((pr) => pr.base !== baseRef)) return true;
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
}) {
  checkRuns = newestChecksByName(checkRuns);
  const missing = [];

  for (const job of requiredJobs) {
    const run = checkRuns.find((item) => item.name === job);
    if (!run) missing.push(`${job} (not present)`);
    else if (run.status !== 'completed' || run.conclusion !== 'success') {
      missing.push(`${job} (status: ${run.status}, conclusion: ${run.conclusion})`);
    }
  }

  for (const workflow of coreWorkflows) {
    if (!workflowAppliesToChanges(changedFiles, workflow.pullRequestPaths)) continue;
    if (workflow.path === '.github/workflows/merge-gate.yml'
      && checkRuns.some((run) => run.name === 'merge-gate')) {
      continue;
    }
    const ran = checkRuns.some((run) => lookupWorkflow(workflowsByCheckId, run.id)?.path === workflow.path);
    if (!ran) missing.push(`${workflow.path} (path filter matched, no check run)`);
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
  const { others, pending, failed } = evaluateOtherChecks(checkRuns);
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
    ready: pending.length === 0,
    ok: errors.length === 0 && pending.length === 0,
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

export function coverageFromPrFiles(files, desktopWorkflow, extraNamed = []) {
  const changed = changedTestPaths(nameStatusFromPrFiles(files));
  const covered = coverageTargets(desktopWorkflow);
  for (const entry of extraNamed) covered.add(`${entry.lane}/${entry.file}`);
  const uncovered = uncoveredTests(changed, covered);
  return { changed, uncovered };
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
      sleepSeconds(wait);
    }
  }
  return null;
}

export function fetchCheckRuns(repo, sha, token) {
  const payload = ghApi(repo, token, `commits/${sha}/check-runs?per_page=100`, { paginate: true });
  if (Array.isArray(payload)) return payload.flatMap((page) => page.check_runs ?? []);
  return payload?.check_runs ?? [];
}

export function fetchPrFiles(repo, prNumber, token) {
  const payload = ghApi(repo, token, `pulls/${prNumber}/files?per_page=100`, { paginate: true });
  return Array.isArray(payload) ? payload : [];
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
  currentRunId = process.env.GITHUB_RUN_ID,
  attributionCache = new Map(),
  resolveWorkflow = resolveWorkflowForCheckRun,
} = {}) {
  const workflowsByCheckId = {};
  const currentId = currentRunId == null || currentRunId === '' ? null : Number(currentRunId);
  for (const run of checkRuns) {
    const urlRunId = actionsRunIdFromCheckRun(run);
    if (currentId != null && Number.isFinite(currentId) && urlRunId === currentId) {
      workflowsByCheckId[run.id] = {
        path: TRUSTED_WORKFLOW_PATH,
        name: 'Merge gate trusted',
        id: currentId,
        event: 'pull_request_target',
      };
      continue;
    }
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

function runCoverage(files, extraNamed) {
  const workflow = readFileSync(path.join(root, '.github/workflows/desktop-checks.yml'), 'utf8');
  const { changed, uncovered } = coverageFromPrFiles(files, workflow, extraNamed);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.REPO;
  const sha = process.env.SHA;
  const token = process.env.GH_TOKEN;
  const prNumber = process.env.PR_NUMBER;
  const baseRef = process.env.BASE_REF;
  const maxAttempts = Number(process.env.MERGE_GATE_MAX_ATTEMPTS ?? 64);
  const pollSeconds = Number(process.env.MERGE_GATE_POLL_SECONDS ?? 30);
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
  if (!runCoverage(files, extraNamed)) process.exit(1);
  if (!runMergeCommandCheck(repo, sha, token)) {
    console.error('Merge-command check failed on the pull request documentation.');
    process.exit(1);
  }
  console.log('Merge-command check passed.');

  if (initialWait > 0) sleepSeconds(initialWait);

  const coreWorkflows = listCoreWorkflows(path.join(root, '.github/workflows'));
  const attributionCache = new Map();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const checkRuns = fetchCheckRuns(repo, sha, token);
    const workflowsByCheckId = resolveWorkflowsForCheckRuns(repo, token, checkRuns, { attributionCache });
    const result = evaluateTrustedGate({
      checkRuns,
      workflowsByCheckId,
      changedFiles,
      coreWorkflows,
      currentRunId: process.env.GITHUB_RUN_ID,
      sha,
      prNumber,
      baseRef,
    });

    if (result.failed.length || result.foreignTrusted.length) {
      for (const error of result.errors) console.error(error);
      process.exit(1);
    }
    if (result.ready) {
      if (result.missingCore.length) {
        for (const error of result.errors) console.error(error);
        process.exit(1);
      }
      console.log(`All ${result.others.length} other checks passed.`);
      process.exit(0);
    }
    console.log(`Waiting for ${result.pending.length} check(s)…`);
    if (attempt < maxAttempts) sleepSeconds(pollSeconds);
  }

  console.error('Timed out waiting for checks.');
  process.exit(1);
}
