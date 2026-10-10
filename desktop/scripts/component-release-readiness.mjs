import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeCheckRunPages, PASS_CONCLUSIONS } from "../../scripts/merge-gate-rate-limit.mjs";
import { actionsRunIdFromCheckRun } from "../../scripts/merge-gate-trusted.mjs";

export const PUSH_BACKUP_MIN_AGE_MS = 25 * 60 * 1000;
export const CATCH_UP_MAX_WAIT_MS = 26 * 60 * 1000;
// The release check is strict (`>` 25 minutes). Stay a few seconds past that
// boundary so the dispatched run does not still observe a closed window.
export const CATCH_UP_WINDOW_BUFFER_MS = 5 * 1000;
// Readiness is a 5-minute job. Three minutes leaves room for checkout and API calls.

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

export function failedCheckRuns(checkRuns) {
  return latestChecksByName(checkRuns).filter((run) => run.conclusion === "failure");
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

export function blockingCheckRuns(checkRuns, { readWorkflowRun } = {}) {
  const blocking = [];
  for (const group of checksGroupedByName(checkRuns).values()) {
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
      if (workflowAttemptBlocks(readWorkflowRun(runId))) blocking.push(newest);
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

function defaultSleep(ms) {
  if (!(ms > 0)) return;
  execFileSync("sleep", [String(ms / 1000)], { windowsHide: true });
}

// One plain gh call. No retry loop: a retry loop spends the shared installation quota (escalation, 2026-10-10).
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
  for (let page = 1; ; page += 1) {
    const payload = parseJson(gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`]), {});
    pages.push(payload);
    const merged = mergeCheckRunPages(pages);
    if (merged.complete) return merged.checkRuns;
    if (!(payload.check_runs?.length)) return merged.checkRuns;
  }
}

// One request, one page of up to 100 check runs. Anything beyond that is reported, never guessed at.
export function listCommitCheckRunsOnce(repo, sha, { gh = defaultGh } = {}) {
  const payload = parseJson(gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]), {});
  const runs = payload.check_runs ?? [];
  if ((payload.total_count ?? runs.length) > runs.length) {
    throw new Error(`check runs for ${sha} span more than one page`);
  }
  return runs;
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
  rerunFailedJobs,
  gh = defaultGh,
} = {}) {
  const list = listCheckRuns ?? (() => listCommitCheckRunsOnce(repo, sha, { gh }));
  const readRun = readWorkflowRun ?? (runId => getWorkflowRun(repo, runId, { gh }));
  const rerun = rerunFailedJobs ?? (runId => rerunFailedWorkflowJobs(repo, runId, { gh }));

  // One listing decides. A failed listing skips this release, and the next scheduled run tries again.
  let listed;
  try {
    listed = list();
  } catch (error) {
    log(`Could not list checks at ${sha}: ${error?.message ?? error}; skipping this release`);
    return { skip: true, failedCount: 0, reran: [], alreadyRetried: [], reason: "checks-unavailable" };
  }
  const firstBlocking = blockingCheckRuns(listed, { readWorkflowRun: readRun });
  if (firstBlocking.length === 0) {
    return { skip: false, failedCount: 0, reran: [], alreadyRetried: [], reason: "no-failed-checks" };
  }
  if (!allowRerun) {
    log(`Not rerunning ${firstBlocking.length} failed check(s); pull-request rehearsal only counts them`);
    return { skip: true, failedCount: firstBlocking.length, reran: [], alreadyRetried: [], reason: "failed-checks" };
  }

  // At most one rerun per failed workflow run. Nothing waits here: a rerun requested now is decided by the
  // next scheduled run, so this job never polls.
  const reran = [];
  const alreadyRetried = [];
  const firstFailed = failedCheckRuns(listed);
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
