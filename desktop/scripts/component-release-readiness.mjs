import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCheckRunPages, PASS_CONCLUSIONS } from "../../scripts/merge-gate-rate-limit.mjs";
import { actionsRunIdFromCheckRun, RECHECK_CHECK } from "../../scripts/merge-gate-trusted.mjs";

export const WORKFLOW_RUN_EVENT = "workflow_run";
export const GITHUB_RATE_LIMIT_FAILURE = /API rate limit exceeded/i;
export const JOB_LOG_FETCH_CAP = 10;
export const CATCH_UP_RUN_NAME = "component-release-catch-up";
export const CATCH_UP_LATCH_REASONS = new Set(["failed-checks", "checks-unavailable"]);
export const CATCH_UP_LATCH_PAGE_SIZE = 20;

export const PUSH_BACKUP_MIN_AGE_MS = 25 * 60 * 1000;
export const CATCH_UP_MAX_WAIT_MS = 26 * 60 * 1000;
// The release check is strict (`>` 25 minutes). Stay a few seconds past that
// boundary so the dispatched run does not still observe a closed window.
export const CATCH_UP_WINDOW_BUFFER_MS = 5 * 1000;
// GitHub returns at most 100 check runs per request. Three pages cover a main
// commit (101 runs is already real). Anything above 300 is skipped, not guessed.
export const CHECK_RUN_PAGE_SIZE = 100;
export const CHECK_RUN_PAGE_CAP = 3;
export const CHECK_RUN_TOTAL_CAP = CHECK_RUN_PAGE_SIZE * CHECK_RUN_PAGE_CAP;

export class CheckRunsOverCapError extends Error {
  constructor(sha, totalCount) {
    super(`check runs for ${sha} exceed ${CHECK_RUN_TOTAL_CAP} (reported ${totalCount})`);
    this.name = "CheckRunsOverCapError";
    this.totalCount = totalCount;
  }
}

export function pushBackupShouldRelease(publishedAt, now = Date.now()) {
  if (publishedAt == null || publishedAt === "") return true;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return true;
  return now - published > PUSH_BACKUP_MIN_AGE_MS;
}

export function catchUpWaitMs(publishedAt, now = Date.now()) {
  if (publishedAt == null || publishedAt === "") return 0;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return 0;
  const remaining = published + PUSH_BACKUP_MIN_AGE_MS + CATCH_UP_WINDOW_BUFFER_MS - now;
  if (remaining <= 0) return 0;
  return Math.min(remaining, CATCH_UP_MAX_WAIT_MS);
}

// One catch-up decision. Same commit as the latest release never dispatches.
// Main ahead of that commit dispatches only once the 25-minute window has passed;
// until then the caller sleeps for waitMs (capped at 26 minutes) and asks again.
export function decideCatchUp({ mainCommit, latestCommit, publishedAt, now = Date.now() } = {}) {
  const head = typeof mainCommit === "string" ? mainCommit : "";
  const released = typeof latestCommit === "string" ? latestCommit : "";
  if (head === "" || released === "") {
    return {
      dispatch: false,
      waitMs: 0,
      reason: "Catch-up could not compare main with the latest release; not dispatching",
    };
  }
  if (head === released) {
    return {
      dispatch: false,
      waitMs: 0,
      reason: `Main is already the latest release (${released}); no catch-up`,
    };
  }
  const waitMs = catchUpWaitMs(publishedAt, now);
  if (waitMs > 0) {
    return {
      dispatch: false,
      waitMs,
      reason: `Main is ahead of the latest release; waiting ${Math.ceil(waitMs / 1000)}s for the 25-minute window`,
    };
  }
  return {
    dispatch: true,
    waitMs: 0,
    reason: "Main is ahead of the latest release and the 25-minute window has passed; dispatching a catch-up release",
  };
}

// A failed publish still catches up when that commit is the live Latest release.
// Rolling Latest back means this commit is not the update apps should follow.
export function isCatchUpMarkedRun(run) {
  if (!run) return false;
  if (run.catch_up === true || run.inputs?.catch_up === true || run.inputs?.catch_up === "true") return true;
  return String(run.display_title ?? "") === CATCH_UP_RUN_NAME
    || String(run.name ?? "") === CATCH_UP_RUN_NAME;
}

export function hasCatchUpDispatch(workflowRuns, headSha) {
  const head = typeof headSha === "string" ? headSha : "";
  return (workflowRuns ?? []).some((run) => {
    if (head && run.head_sha && run.head_sha !== head) return false;
    return isCatchUpMarkedRun(run);
  });
}

// Failed-checks and listing-unavailable retries dispatch at most once per main head.
// Over-cap never dispatches: the listing is incomplete, so a retry would loop.
export function decideSkipReasonCatchUp({ skipReason, mainCommit, workflowRuns } = {}) {
  if (skipReason === "checks-over-cap") {
    return {
      dispatch: false,
      reason: "Check runs exceed the cap; not dispatching catch-up",
    };
  }
  if (!CATCH_UP_LATCH_REASONS.has(skipReason)) {
    return {
      dispatch: true,
      reason: "Catch-up latch does not apply",
    };
  }
  if (hasCatchUpDispatch(workflowRuns, mainCommit)) {
    return {
      dispatch: false,
      reason: `Catch-up already dispatched for ${mainCommit}; not dispatching again`,
    };
  }
  return {
    dispatch: true,
    reason: `No catch-up dispatch yet for ${mainCommit}; dispatching once`,
  };
}

export function catchUpAfterFailedPublish({ latestCommit, releasedCommit } = {}) {
  const released = typeof releasedCommit === "string" ? releasedCommit : "";
  const latest = typeof latestCommit === "string" ? latestCommit : "";
  if (released !== "" && latest === released) {
    return {
      proceed: true,
      reason: `Publish failed but ${released} is still Latest; continuing catch-up`,
    };
  }
  return {
    proceed: false,
    reason: "Publish failed and this commit is not Latest; skipping catch-up",
  };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return "";
  return argv[index + 1] ?? "";
}

function checkRunTime(run) {
  return Date.parse(run?.started_at ?? "") || Date.parse(run?.completed_at ?? "") || 0;
}

function checkRunIsNewer(candidate, current) {
  const newerStarted = checkRunTime(candidate) - checkRunTime(current);
  if (newerStarted !== 0) return newerStarted > 0;
  return Number(candidate?.id ?? 0) > Number(current?.id ?? 0);
}

export function latestChecksByName(checkRuns) {
  const latest = new Map();
  for (const run of checkRuns ?? []) {
    const name = run?.name;
    if (!name) continue;
    const previous = latest.get(name);
    if (!previous || checkRunIsNewer(run, previous)) latest.set(name, run);
  }
  return [...latest.values()];
}

export function checkRunDiagnosticText(run) {
  const output = run?.output ?? {};
  const annotations = Array.isArray(output.annotations)
    ? output.annotations.map((item) => [item?.title, item?.message].filter(Boolean).join("\n")).join("\n")
    : "";
  return [output.title, output.summary, output.text, annotations].filter(Boolean).join("\n");
}

export function isGithubRateLimitFailure(run, jobLogText) {
  if (GITHUB_RATE_LIMIT_FAILURE.test(checkRunDiagnosticText(run))) return true;
  return GITHUB_RATE_LIMIT_FAILURE.test(String(jobLogText ?? ""));
}

export function actionsJobIdFromCheckRun(checkRun) {
  const fromUrl = String(checkRun?.details_url ?? checkRun?.html_url ?? "").match(/\/actions\/runs\/\d+\/job\/(\d+)/);
  return fromUrl ? Number(fromUrl[1]) : null;
}

export function getJobLog(repo, jobId, { gh = defaultGh } = {}) {
  // gh 2.102.0 exits 1 with an empty body when an Actions log has ANSI escapes.
  return String(gh(["api", "--allow-escape-sequences", `repos/${repo}/actions/jobs/${jobId}/logs`]) ?? "");
}

export function catchUpLatchRunsPath(repo, sha) {
  return `repos/${repo}/actions/workflows/component-release.yml/runs?head_sha=${sha}&event=workflow_dispatch&per_page=${CATCH_UP_LATCH_PAGE_SIZE}`;
}

export function listCatchUpLatchRuns(repo, sha, { gh = defaultGh } = {}) {
  return parseJson(gh(["api", catchUpLatchRunsPath(repo, sha)]), {}).workflow_runs ?? [];
}

// Fetch logs only for failed Actions jobs that are not already ignored. Cap the
// number of fetches. A failed or skipped fetch stays a real failure.
export function fetchFailedActionJobLogs(checkRuns, { readJobLog, cap = JOB_LOG_FETCH_CAP } = {}) {
  const logs = new Map();
  if (!readJobLog) return logs;
  let fetches = 0;
  for (const run of checkRuns ?? []) {
    if (run?.conclusion !== "failure") continue;
    if (isIgnoredReleaseCheckRun(run)) continue;
    const jobId = actionsJobIdFromCheckRun(run);
    if (jobId == null) continue;
    if (fetches >= cap) {
      logs.set(run.id, { ok: false, reason: "cap" });
      continue;
    }
    fetches += 1;
    try {
      logs.set(run.id, { ok: true, text: String(readJobLog(jobId) ?? "") });
    } catch {
      logs.set(run.id, { ok: false, reason: "fetch-failed" });
    }
  }
  return logs;
}

// Recheck and other workflow_run jobs attach to main for other pull-request heads.
// A 403 whose check output or Actions job log is only GitHub's rate-limit text is
// not a product failure. A missing log is a real failure.
export function isIgnoredReleaseCheckRun(run, workflow, jobLog) {
  if (!run) return false;
  if (run.name === RECHECK_CHECK) return true;
  const event = run.event ?? workflow?.event;
  if (event === WORKFLOW_RUN_EVENT) return true;
  if (isGithubRateLimitFailure(run, jobLog?.ok ? jobLog.text : "")) return true;
  return false;
}

export function failedCheckRuns(checkRuns, { readJobLog, jobLogs } = {}) {
  const logs = jobLogs ?? fetchFailedActionJobLogs(checkRuns, { readJobLog });
  return latestChecksByName(checkRuns).filter((run) => (
    run.conclusion === "failure" && !isIgnoredReleaseCheckRun(run, null, logs.get(run.id))
  ));
}

export function checksGroupedByName(checkRuns) {
  const groups = new Map();
  for (const run of checkRuns ?? []) {
    const name = run?.name;
    if (!name) continue;
    const group = groups.get(name);
    if (group) group.push(run);
    else groups.set(name, [run]);
  }
  return groups;
}

export function newestCheckInGroup(checks) {
  let newest = null;
  for (const run of checks ?? []) {
    if (!newest || checkRunIsNewer(run, newest)) newest = run;
  }
  return newest;
}

function workflowAttemptBlocks(run) {
  const attempt = Number(run?.run_attempt);
  return Number.isFinite(attempt) && attempt > 1 && run.status !== "completed";
}

export function blockingCheckRuns(checkRuns, { readWorkflowRun, readJobLog, jobLogs } = {}) {
  const logs = jobLogs ?? fetchFailedActionJobLogs(checkRuns, { readJobLog });
  const considered = (checkRuns ?? []).filter((run) => !isIgnoredReleaseCheckRun(run, null, logs.get(run.id)));
  const blocking = [];
  for (const group of checksGroupedByName(considered).values()) {
    const newest = newestCheckInGroup(group);
    if (!newest || PASS_CONCLUSIONS.has(newest.conclusion)) continue;
    if (newest.conclusion === "failure") {
      blocking.push(newest);
      continue;
    }
    const olderFailed = group.some((run) => run !== newest && run.conclusion === "failure");
    if (olderFailed) {
      blocking.push(newest);
      continue;
    }
    const runId = workflowRunIdFromCheck(newest);
    if (runId == null || !readWorkflowRun) continue;
    try {
      const workflow = readWorkflowRun(runId);
      if (isIgnoredReleaseCheckRun(newest, workflow)) continue;
      if (workflowAttemptBlocks(workflow)) blocking.push(newest);
    } catch {
      // Same as a missing run: a first-attempt pending check stays non-blocking.
    }
  }
  return blocking;
}

export function workflowRunIdFromCheck(checkRun) {
  return actionsRunIdFromCheckRun(checkRun);
}

export function shouldRerunFailedWorkflow(run) {
  const attempt = Number(run?.run_attempt);
  return !Number.isFinite(attempt) || attempt <= 1;
}

// One plain gh call. No retry loop: a retry spends the shared installation quota.
function defaultGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", windowsHide: true, env: process.env });
}

function parseJson(raw, fallback) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  return JSON.parse(text);
}

export function listCommitCheckRuns(repo, sha, { gh = defaultGh } = {}) {
  const pages = [];
  for (let page = 1; page <= CHECK_RUN_PAGE_CAP; page += 1) {
    const payload = parseJson(
      gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=${CHECK_RUN_PAGE_SIZE}&page=${page}`]),
      {},
    );
    pages.push(payload);
    const merged = mergeCheckRunPages(pages);
    if (merged.totalCount > CHECK_RUN_TOTAL_CAP) {
      throw new CheckRunsOverCapError(sha, merged.totalCount);
    }
    if (merged.complete) return merged.checkRuns;
    const pageLen = Array.isArray(payload?.check_runs) ? payload.check_runs.length : 0;
    if (pageLen === 0) return merged.checkRuns;
  }
  return mergeCheckRunPages(pages).checkRuns;
}

export function getWorkflowRun(repo, runId, { gh = defaultGh } = {}) {
  return parseJson(gh(["api", `repos/${repo}/actions/runs/${runId}`]), null);
}

export function rerunFailedWorkflowJobs(repo, runId, { gh = defaultGh } = {}) {
  gh(["api", "-X", "POST", `repos/${repo}/actions/runs/${runId}/rerun-failed-jobs`]);
}

function uniqueWorkflowRunIds(checkRuns) {
  const ids = [];
  const seen = new Set();
  for (const check of checkRuns) {
    const runId = workflowRunIdFromCheck(check);
    if (runId == null || seen.has(runId)) continue;
    seen.add(runId);
    ids.push(runId);
  }
  return ids;
}

export function resolveFailedReleaseChecks({
  sha,
  repo = process.env.GITHUB_REPOSITORY || "KeepOak/Branch-Agent",
  log = console.error,
  allowRerun = process.env.GITHUB_EVENT_NAME !== "pull_request",
  listCheckRuns,
  readWorkflowRun,
  readJobLog,
  rerunFailedJobs,
  gh = defaultGh,
} = {}) {
  const list = listCheckRuns ?? (() => listCommitCheckRuns(repo, sha, { gh }));
  const readRun = readWorkflowRun ?? (runId => getWorkflowRun(repo, runId, { gh }));
  const rerun = rerunFailedJobs ?? (runId => rerunFailedWorkflowJobs(repo, runId, { gh }));
  const readLog = readJobLog !== undefined
    ? readJobLog
    : (listCheckRuns ? undefined : (jobId => getJobLog(repo, jobId, { gh })));

  // One listing decides. A failed listing skips this release. The next scheduled run tries again.
  let listed;
  try {
    listed = list();
  } catch (error) {
    const overCap = error instanceof CheckRunsOverCapError;
    if (overCap) {
      log(`Check runs at ${sha} exceed ${CHECK_RUN_TOTAL_CAP}; skipping this release`);
    } else {
      log(`Could not list checks at ${sha}: ${error?.message ?? error}; skipping this release`);
    }
    return {
      skip: true,
      failedCount: 0,
      reran: [],
      alreadyRetried: [],
      reason: overCap ? "checks-over-cap" : "checks-unavailable",
    };
  }
  const jobLogs = fetchFailedActionJobLogs(listed, { readJobLog: readLog });
  const firstBlocking = blockingCheckRuns(listed, { readWorkflowRun: readRun, jobLogs });
  if (firstBlocking.length === 0) {
    return { skip: false, failedCount: 0, reran: [], alreadyRetried: [], reason: "no-failed-checks" };
  }
  if (!allowRerun) {
    log(`Not rerunning ${firstBlocking.length} failed check(s); pull-request rehearsal only counts them`);
    return { skip: true, failedCount: firstBlocking.length, reran: [], alreadyRetried: [], reason: "failed-checks" };
  }

  // At most one rerun per failed workflow run. Nothing waits here: the next scheduled run decides.
  const reran = [];
  const alreadyRetried = [];
  const firstFailed = failedCheckRuns(listed, { jobLogs });
  for (const runId of uniqueWorkflowRunIds(firstFailed)) {
    const names = firstFailed.filter((check) => workflowRunIdFromCheck(check) === runId).map((check) => check.name);
    let run = null;
    try {
      run = readRun(runId);
    } catch (error) {
      log(`Could not load workflow run ${runId} (${names.join(", ")}): ${error?.message ?? error}`);
    }
    if (!shouldRerunFailedWorkflow(run)) {
      log(`Not rerunning ${names.join(", ")} (run ${runId}): already attempt ${run?.run_attempt}`);
      alreadyRetried.push({ runId, attempt: Number(run?.run_attempt), names });
      continue;
    }
    try {
      log(`Rerunning failed jobs for ${names.join(", ")} (run ${runId}, attempt ${run?.run_attempt ?? 1}); the next scheduled run decides`);
      rerun(runId);
      reran.push({ runId, attempt: Number(run?.run_attempt ?? 1), names });
    } catch (error) {
      log(`Could not rerun failed jobs for ${names.join(", ")} (run ${runId}): ${error?.message ?? error}`);
    }
  }
  return {
    skip: true,
    failedCount: firstBlocking.length,
    reran,
    alreadyRetried,
    reason: reran.length > 0 ? "rerun-requested" : "failed-checks",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "catch-up-after-failed-publish") {
    const decision = catchUpAfterFailedPublish({
      latestCommit: argValue(process.argv, "--latest"),
      releasedCommit: argValue(process.argv, "--released"),
    });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exit(0);
  }
  if (process.argv[2] === "decide-skip-catch-up") {
    const runsRaw = argValue(process.argv, "--runs");
    let workflowRuns;
    if (runsRaw !== "") {
      const parsed = JSON.parse(runsRaw);
      workflowRuns = Array.isArray(parsed) ? parsed : parsed?.workflow_runs;
    }
    const decision = decideSkipReasonCatchUp({
      skipReason: argValue(process.argv, "--reason"),
      mainCommit: argValue(process.argv, "--main"),
      workflowRuns,
    });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exit(0);
  }
  if (process.argv[2] === "decide-catch-up") {
    const nowArg = argValue(process.argv, "--now");
    const decision = decideCatchUp({
      mainCommit: argValue(process.argv, "--main"),
      latestCommit: argValue(process.argv, "--latest"),
      publishedAt: argValue(process.argv, "--published-at"),
      now: nowArg === "" ? Date.now() : Number(nowArg),
    });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exit(0);
  }
  if (process.argv[2] === "resolve-failed-checks") {
    const decision = resolveFailedReleaseChecks({
      sha: argValue(process.argv, "--sha"),
      repo: argValue(process.argv, "--repo") || process.env.GITHUB_REPOSITORY || "KeepOak/Branch-Agent",
    });
    process.stdout.write(`${JSON.stringify({
      failedCount: decision.failedCount,
      skip: decision.skip,
      reason: decision.reason,
    })}\n`);
    process.exit(0);
  }
  process.exit(pushBackupShouldRelease(process.argv[2]) ? 0 : 1);
}
