import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GATE_SCRIPTS, fetchFileText, fetchPrFiles, gateApiBudget, ghApi } from './merge-gate-trusted.mjs';
import { isRateLimitError } from './merge-gate-rate-limit.mjs';

// Budget for every GitHub call in the job. The job limit is 5 minutes: this budget, about 90 s of checkout and setup, and a margin.
export const DEFAULT_GATE_FILES_BUDGET_SECONDS = 120;

// The job's rate-limit wait budget, from MERGE_GATE_WAIT_SECONDS. The job limit is this plus setup margin.
export function gateFilesBudgetSeconds(env = process.env) {
  const value = Number(env.MERGE_GATE_WAIT_SECONDS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_GATE_FILES_BUDGET_SECONDS;
}

export function formatGateFilesError(error, budgetSeconds) {
  if (isRateLimitError(error)) {
    return `GitHub API rate limit outlasted the ${budgetSeconds}s wait budget. This is not a gate-file failure; re-run gate-files-fresh.`;
  }
  return `gate-files-fresh could not read GitHub: ${String(error?.message ?? error).split('\n')[0]}`;
}

export const KEEP_MAIN_MESSAGE = 'merge main in and keep main\'s version of this file';

export const GATE_WORKFLOW_FILES = [
  '.github/workflows/merge-gate.yml',
  '.github/workflows/merge-gate-trusted.yml',
  '.github/workflows/gate-files-fresh.yml',
  'scripts/merge-gate-trusted.mjs',
  'scripts/check-gate-files-fresh.mjs',
];

export function listedGateFiles(gateScripts = GATE_SCRIPTS) {
  return [...new Set([...GATE_WORKFLOW_FILES, ...gateScripts])].sort();
}

export function changedPathsFromPrFiles(files) {
  return [...new Set(files.flatMap((file) => (
    file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]
  )))];
}

export function touchedGateFiles(changedFiles, gateFiles) {
  const changed = new Set(changedFiles);
  return gateFiles.filter((file) => changed.has(file));
}

export function isMergeCommit(commit) {
  return (commit.parents?.length ?? 0) >= 2;
}

export function forkPointSha({ commits, mergeBaseSha }) {
  const prShas = new Set(commits.map((commit) => commit.sha));
  const nonMerge = commits.filter((commit) => !isMergeCommit(commit));
  const oldest = nonMerge.find((commit) => !prShas.has(commit.parents?.[0]?.sha))
    ?? nonMerge[0];
  if (!oldest) return mergeBaseSha;
  return oldest.parents?.[0]?.sha ?? mergeBaseSha;
}

export function splitLines(text) {
  if (text == null || text === '') return [];
  return String(text).split(/\r?\n/);
}

export function addedLines(beforeText, afterText) {
  const remaining = new Map();
  for (const line of splitLines(beforeText)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const added = [];
  for (const line of splitLines(afterText)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else added.push(line);
  }
  return added;
}

export function missingAddedLines(added, headText) {
  const remaining = new Map();
  for (const line of splitLines(headText)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }
  const missing = [];
  for (const line of added) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
    else missing.push(line);
  }
  return missing;
}

export function addedLinesFromPatch(patch) {
  if (!patch) return [];
  const added = [];
  for (const line of String(patch).split(/\r?\n/)) {
    if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
  }
  return added;
}

export function attributeDroppedLines(droppedLines, commitsOldestFirst) {
  const wanted = new Set(droppedLines);
  const byLine = new Map();
  for (const commit of commitsOldestFirst) {
    for (const line of commit.addedLines ?? []) {
      if (wanted.has(line)) byLine.set(line, commit.sha);
    }
  }
  return byLine;
}

export function evaluateGateFiles({
  changedFiles,
  gateFiles,
  prCommits,
  mergeBaseSha,
  fileSnapshots,
  lineCommits,
}) {
  const touched = touchedGateFiles(changedFiles, gateFiles);
  if (!touched.length) {
    return { ok: true, skipped: true, forkPoint: null, results: [] };
  }
  const forkPoint = forkPointSha({ commits: prCommits, mergeBaseSha });
  const results = touched.map((file) => {
    const snap = fileSnapshots?.[file] ?? {};
    const missing = missingAddedLines(addedLines(snap.fork, snap.main), snap.head);
    const dropped = missing.map((line) => ({
      line,
      commit: lineCommits?.[file]?.[line] ?? null,
    }));
    return { file, ok: dropped.length === 0, dropped };
  });
  return {
    ok: results.every((result) => result.ok),
    skipped: false,
    forkPoint,
    results,
  };
}

export function formatReport(result) {
  if (result.skipped) return 'No gate files changed.';
  if (result.ok) {
    return `Gate files are fresh relative to main (${result.results.length} file(s)).`;
  }
  const lines = [];
  for (const item of result.results.filter((resultItem) => !resultItem.ok)) {
    lines.push(`${item.file}: ${KEEP_MAIN_MESSAGE}`);
    for (const drop of item.dropped) {
      lines.push(`  ${drop.commit ?? 'unknown'}: ${drop.line}`);
    }
  }
  return lines.join('\n');
}

export function fetchPrCommits(repo, prNumber, token) {
  const payload = ghApi(repo, token, `pulls/${prNumber}/commits?per_page=100`, { paginate: true });
  return Array.isArray(payload) ? payload : [];
}

export const COMPARE_FILE_PAGE_SIZE = 100;
export const COMPARE_FILE_LIMIT = 300;
export const COMPARE_SLIM_JQ = [
  '{',
  'merge_base_sha: .merge_base_commit.sha,',
  'commits: [.commits[].sha],',
  'truncated: .truncated,',
  'total_commits: .total_commits,',
  'files: [.files[].filename]',
  '}',
].join(' ');
export const COMPARE_FILES_JQ = '[.files[].filename]';
export const COMPARE_COMMITS_JQ = '[.commits[].sha]';
export const COMPARE_COMMIT_MAX_PAGES = 3;

export function compareTooLargeMessage(base, head, {
  truncated,
  fileCount,
  commitCount,
  totalCommits,
} = {}) {
  return [
    `Compare ${base}...${head} is too large or truncated`,
    `(files=${fileCount ?? 0}, commits=${commitCount ?? 0},`,
    `total_commits=${totalCommits ?? '?'}, truncated=${Boolean(truncated)}).`,
    'Merge main so the fork point is recent, then re-run gate-files-fresh.',
  ].join(' ');
}

export function fetchCompare(repo, token, base, head, options = {}) {
  return fetchComparePaged(repo, token, base, head, options);
}

// GitHub pages the commit list (per_page applies to commits) but returns the file list on page 1 only.
export function fetchComparePaged(repo, token, base, head, { api = ghApi, requireComplete = true } = {}) {
  const firstPath = `compare/${base}...${head}?per_page=${COMPARE_FILE_PAGE_SIZE}&page=1`;
  const slim = api(repo, token, firstPath, { jq: COMPARE_SLIM_JQ }) ?? {};
  const files = [...(Array.isArray(slim.files) ? slim.files : [])];
  const commits = Array.isArray(slim.commits) ? slim.commits : [];
  const truncated = Boolean(slim.truncated);
  const totalCommits = Number.isInteger(slim.total_commits) ? slim.total_commits : commits.length;
  for (let page = 2; !truncated && commits.length < totalCommits && page <= COMPARE_COMMIT_MAX_PAGES; page += 1) {
    const shas = api(repo, token, `compare/${base}...${head}?per_page=${COMPARE_FILE_PAGE_SIZE}&page=${page}`, {
      jq: COMPARE_COMMITS_JQ,
    });
    const names = Array.isArray(shas) ? shas : [];
    if (!names.length) break;
    commits.push(...names);
    if (names.length < COMPARE_FILE_PAGE_SIZE) break;
  }
  for (let page = 2; !truncated && files.length < COMPARE_FILE_LIMIT; page += 1) {
    const more = api(repo, token, `compare/${base}...${head}?per_page=${COMPARE_FILE_PAGE_SIZE}&page=${page}`, {
      jq: COMPARE_FILES_JQ,
    });
    const names = Array.isArray(more) ? more : [];
    if (!names.length) break;
    files.push(...names);
    if (names.length < COMPARE_FILE_PAGE_SIZE) break;
  }
  const tooLarge = truncated
    || files.length > COMPARE_FILE_LIMIT
    || totalCommits > commits.length;
  if (requireComplete && tooLarge) {
    throw new Error(compareTooLargeMessage(base, head, {
      truncated,
      fileCount: files.length,
      commitCount: commits.length,
      totalCommits: slim.total_commits,
    }));
  }
  return {
    merge_base_commit: slim.merge_base_sha ? { sha: slim.merge_base_sha } : undefined,
    commits: commits.map((sha) => ({ sha })),
    files: files.map((filename) => ({ filename })),
    truncated,
    total_commits: slim.total_commits ?? commits.length,
  };
}

export function fetchCommitsForPath(repo, token, sha, filePath) {
  const payload = ghApi(repo, token, `commits?sha=${sha}&path=${filePath}&per_page=100`, {
    paginate: true,
  });
  return Array.isArray(payload) ? payload : [];
}

export function fetchCommit(repo, token, sha) {
  return ghApi(repo, token, `commits/${sha}`);
}

export async function checkPullRequest({
  repo,
  token,
  prNumber,
  headSha,
  mainRef,
  api = {
    fetchPrFiles,
    fetchPrCommits,
    fetchCompare,
    fetchFileText,
    fetchCommitsForPath,
    fetchCommit,
  },
}) {
  const prFiles = api.fetchPrFiles(repo, prNumber, token);
  const changedFiles = changedPathsFromPrFiles(prFiles);
  const gateFiles = listedGateFiles();
  const touched = touchedGateFiles(changedFiles, gateFiles);
  if (!touched.length) {
    return { ok: true, skipped: true, forkPoint: null, results: [] };
  }

  const prCommits = api.fetchPrCommits(repo, prNumber, token);
  const againstHead = api.fetchCompare(repo, token, mainRef, headSha);
  const mergeBaseSha = againstHead.merge_base_commit?.sha ?? null;
  const forkPoint = forkPointSha({ commits: prCommits, mergeBaseSha });
  if (!forkPoint) {
    throw new Error('Could not determine the pull request fork point from main');
  }
  // Attribution only: the pass/fail decision comes from the file snapshots below. An incomplete list
  // labels a line's commit "unknown" instead of failing the gate.
  const againstMain = api.fetchCompare(repo, token, forkPoint, mainRef, { requireComplete: false });
  const mainCommitShas = new Set((againstMain.commits ?? []).map((commit) => commit.sha));

  const fileSnapshots = {};
  const lineCommits = {};
  for (const file of touched) {
    fileSnapshots[file] = {
      fork: api.fetchFileText(repo, forkPoint, token, file) ?? '',
      main: api.fetchFileText(repo, mainRef, token, file) ?? '',
      head: api.fetchFileText(repo, headSha, token, file)
        ?? api.fetchFileText(repo, `refs/pull/${prNumber}/head`, token, file)
        ?? '',
    };
    const missing = missingAddedLines(
      addedLines(fileSnapshots[file].fork, fileSnapshots[file].main),
      fileSnapshots[file].head,
    );
    if (!missing.length) continue;
    const pathCommits = (api.fetchCommitsForPath(repo, token, mainRef, file) ?? [])
      .filter((commit) => mainCommitShas.has(commit.sha))
      .reverse();
    const attributed = [];
    for (const commit of pathCommits) {
      const detail = api.fetchCommit(repo, token, commit.sha);
      const patch = (detail?.files ?? []).find((entry) => entry.filename === file)?.patch;
      attributed.push({ sha: commit.sha, addedLines: addedLinesFromPatch(patch) });
    }
    lineCommits[file] = Object.fromEntries(attributeDroppedLines(missing, attributed));
  }

  return evaluateGateFiles({
    changedFiles: touched,
    gateFiles,
    prCommits,
    mergeBaseSha,
    fileSnapshots,
    lineCommits,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.REPO;
  const token = process.env.GH_TOKEN;
  const prNumber = process.env.PR_NUMBER;
  const headSha = process.env.HEAD_SHA;
  const mainRef = process.env.MAIN_SHA || process.env.MAIN_REF || process.env.BASE_REF;

  if (!repo || !token || !prNumber || !headSha || !mainRef) {
    console.error('Missing required environment variables: REPO, GH_TOKEN, PR_NUMBER, HEAD_SHA, and MAIN_SHA or MAIN_REF');
    process.exit(1);
  }

  const budgetSeconds = gateFilesBudgetSeconds(process.env);
  gateApiBudget.budgetSeconds = budgetSeconds;
  gateApiBudget.startedAt = Date.now();
  let result;
  try {
    result = await checkPullRequest({
      repo,
      token,
      prNumber,
      headSha,
      mainRef,
    });
  } catch (error) {
    console.error(formatGateFilesError(error, budgetSeconds));
    process.exit(1);
  }
  const report = formatReport(result);
  if (!result.ok) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}
