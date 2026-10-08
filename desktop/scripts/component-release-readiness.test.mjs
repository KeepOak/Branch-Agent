import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CATCH_UP_MAX_WAIT_MS,
  CATCH_UP_WINDOW_BUFFER_MS,
  FAILED_CHECK_RERUN_POLL_MS,
  FAILED_CHECK_RERUN_WAIT_MS,
  PUSH_BACKUP_MIN_AGE_MS,
  catchUpAfterFailedPublish,
  decideCatchUp,
  failedCheckRuns,
  getWorkflowRun,
  listCommitCheckRuns,
  pushBackupShouldRelease,
  rerunFailedWorkflowJobs,
  resolveFailedReleaseChecks,
  shouldRerunFailedWorkflow,
} from "./component-release-readiness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(here, "../../.github/workflows/component-release.yml"), "utf8").replace(/\r\n/g, "\n");
const desktopChecks = readFileSync(join(here, "../../.github/workflows/desktop-checks.yml"), "utf8").replace(/\r\n/g, "\n");
const helper = join(here, "component-release-readiness.mjs");

test("push backup releases when there is no previous publication time", () => {
  assert.equal(pushBackupShouldRelease(undefined), true);
  assert.equal(pushBackupShouldRelease(""), true);
  assert.equal(pushBackupShouldRelease("not-a-date"), true);
});

test("push backup waits until the latest release is more than 25 minutes old", () => {
  const now = Date.parse("2026-10-08T04:35:00Z");
  assert.equal(PUSH_BACKUP_MIN_AGE_MS, 25 * 60 * 1000);
  assert.equal(pushBackupShouldRelease("2026-10-08T04:10:00Z", now), false);
  assert.equal(pushBackupShouldRelease("2026-10-08T04:10:00.000Z", now), false);
  assert.equal(pushBackupShouldRelease(new Date(now - PUSH_BACKUP_MIN_AGE_MS).toISOString(), now), false);
  assert.equal(pushBackupShouldRelease(new Date(now - PUSH_BACKUP_MIN_AGE_MS - 1).toISOString(), now), true);
  assert.equal(pushBackupShouldRelease("2026-10-08T04:09:59Z", now), true);
});

test("readiness CLI exits 0 only when a push backup should release", () => {
  const run = publishedAt => {
    try {
      execFileSync(process.execPath, [helper, publishedAt], { stdio: "ignore", windowsHide: true });
      return 0;
    } catch (error) {
      return error.status;
    }
  };
  assert.equal(run(""), 0);
  assert.equal(run("2000-01-01T00:00:00Z"), 0);
  assert.equal(run(new Date(Date.now() - 60_000).toISOString()), 1);
});

test("component-release workflow keeps the schedule and uses push as a 25-minute backup", () => {
  assert.match(workflow, /^  push:\n    branches: \[main\]\n    tags:/m);
  assert.match(workflow, /cron: '7,37 \* \* \* \*'/);
  assert.match(workflow, /cancel-in-progress: \$\{\{\s*github\.event_name\s*==\s*'pull_request'\s*\}\}/);
  assert.match(workflow, /node desktop\/scripts\/component-release-readiness\.mjs/);
  assert.match(workflow, /more than 25 minutes old/);
  assert.match(workflow, /GITHUB_EVENT_NAME" == "push"/);
  assert.match(workflow, /GITHUB_EVENT_NAME" == "schedule"/);
  assert.match(workflow, /decide_scheduled >\/dev\/null \|\| echo "scheduled rehearsal could not finish"/);
  assert.match(workflow, /node scripts\/merge-gate-rate-limit\.mjs gh -- api/);
  const readiness = workflow.slice(workflow.indexOf("decide_scheduled()"), workflow.indexOf("\n  identity:"));
  const windowAt = readiness.indexOf("more than 25 minutes old");
  const checksAt = readiness.indexOf("resolve-failed-checks");
  assert.ok(windowAt !== -1 && checksAt !== -1 && windowAt < checksAt);
  assert.match(readiness, /resolve-failed-checks --sha/);
});

test("failed publish catches up only while that commit is still Latest", () => {
  const released = "a".repeat(40);
  const exposed = catchUpAfterFailedPublish({ latestCommit: released, releasedCommit: released });
  assert.equal(exposed.proceed, true);
  assert.match(exposed.reason, /still Latest/);
  const hidden = catchUpAfterFailedPublish({ latestCommit: "b".repeat(40), releasedCommit: released });
  assert.equal(hidden.proceed, false);
  assert.match(hidden.reason, /not Latest/);
  assert.equal(catchUpAfterFailedPublish({ latestCommit: "", releasedCommit: released }).proceed, false);
});

test("catch-up does not dispatch when main is the released commit", () => {
  const now = Date.parse("2026-10-08T09:10:00Z");
  const decision = decideCatchUp({
    mainCommit: "abc123",
    latestCommit: "abc123",
    publishedAt: "2026-10-08T08:35:00Z",
    now,
  });
  assert.equal(decision.dispatch, false);
  assert.equal(decision.waitMs, 0);
  assert.match(decision.reason, /already the latest release/);
});

test("catch-up dispatches only after the window when main is ahead", () => {
  const publishedAt = "2026-10-08T08:35:36Z";
  const published = Date.parse(publishedAt);
  const during = decideCatchUp({
    mainCommit: "new-head",
    latestCommit: "released",
    publishedAt,
    now: published + 10 * 60 * 1000,
  });
  assert.equal(during.dispatch, false);
  assert.ok(during.waitMs > 0);
  assert.ok(during.waitMs <= CATCH_UP_MAX_WAIT_MS);

  const atWindow = decideCatchUp({
    mainCommit: "new-head",
    latestCommit: "released",
    publishedAt,
    now: published + PUSH_BACKUP_MIN_AGE_MS,
  });
  assert.equal(atWindow.dispatch, false);
  assert.equal(atWindow.waitMs, CATCH_UP_WINDOW_BUFFER_MS);

  const ready = decideCatchUp({
    mainCommit: "new-head",
    latestCommit: "released",
    publishedAt,
    now: published + PUSH_BACKUP_MIN_AGE_MS + CATCH_UP_WINDOW_BUFFER_MS,
  });
  assert.equal(ready.dispatch, true);
  assert.equal(ready.waitMs, 0);
  assert.match(ready.reason, /dispatching a catch-up release/);
});

test("catch-up wait is capped at 26 minutes and a missing release does not dispatch", () => {
  assert.equal(CATCH_UP_MAX_WAIT_MS, 26 * 60 * 1000);
  const now = Date.parse("2026-10-08T08:35:00Z");
  const capped = decideCatchUp({
    mainCommit: "new-head",
    latestCommit: "released",
    publishedAt: new Date(now + 2 * 60 * 1000).toISOString(),
    now,
  });
  assert.equal(capped.dispatch, false);
  assert.equal(capped.waitMs, CATCH_UP_MAX_WAIT_MS);
  const missing = decideCatchUp({
    mainCommit: "abc123",
    latestCommit: "",
    publishedAt: "2000-01-01T00:00:00Z",
    now,
  });
  assert.equal(missing.dispatch, false);
  assert.equal(missing.waitMs, 0);
});

test("decide-catch-up CLI reports no dispatch for a released head and dispatch once the window has passed", () => {
  const run = args => JSON.parse(execFileSync(process.execPath, [helper, "decide-catch-up", ...args], {
    encoding: "utf8",
    windowsHide: true,
  }));
  const same = run([
    "--main", "abc123",
    "--latest", "abc123",
    "--published-at", "2026-10-08T08:35:00Z",
    "--now", String(Date.parse("2026-10-08T09:10:00Z")),
  ]);
  assert.equal(same.dispatch, false);
  assert.equal(same.waitMs, 0);
  const published = Date.parse("2026-10-08T08:35:36Z");
  const ahead = run([
    "--main", "new-head",
    "--latest", "released",
    "--published-at", "2026-10-08T08:35:36Z",
    "--now", String(published + PUSH_BACKUP_MIN_AGE_MS + CATCH_UP_WINDOW_BUFFER_MS),
  ]);
  assert.equal(ahead.dispatch, true);
  assert.equal(ahead.waitMs, 0);
});

test("catch-up job waits out the cooldown and dispatches one release", () => {
  const catchUp = workflow.slice(workflow.indexOf("\n  catch-up:"));
  assert.ok(catchUp.length > 0);
  assert.match(catchUp, /needs: \[readiness, identity, publish\]/);
  assert.match(catchUp, /always\(\) && !cancelled\(\)/);
  assert.match(catchUp, /needs\.publish\.result == 'success' \|\| needs\.publish\.result == 'failure'/);
  assert.match(catchUp, /needs\.readiness\.outputs\.skip_reason == 'cooldown'/);
  assert.match(catchUp, /catch-up-after-failed-publish/);
  assert.match(catchUp, /github\.event_name != 'pull_request'/);
  assert.match(catchUp, /group: github-component-release-catch-up\n\s+cancel-in-progress: true/);
  assert.match(catchUp, /actions: write/);
  assert.match(catchUp, /timeout-minutes: 30/);
  assert.match(catchUp, /max_sleep_seconds=\$\(\(26 \* 60\)\)/);
  assert.match(catchUp, /decide-catch-up/);
  assert.match(catchUp, /gh workflow run component-release\.yml --ref main/);
  assert.match(catchUp, /node scripts\/merge-gate-rate-limit\.mjs gh -- api/);
  assert.doesNotMatch(catchUp, /check-runs/);
  assert.doesNotMatch(catchUp, /contents: write/);
  assert.equal(workflow.match(/actions: write/g).length, 2);
  const readinessJob = workflow.slice(workflow.indexOf("\n  readiness:"), workflow.indexOf("\n  readiness-rehearsal:"));
  const rehearsalJob = workflow.slice(workflow.indexOf("\n  readiness-rehearsal:"), workflow.indexOf("\n  identity:"));
  const identityJob = workflow.slice(workflow.indexOf("\n  identity:"), workflow.indexOf("\n  window:"));
  assert.match(readinessJob, /github\.event_name != 'pull_request'/);
  assert.match(readinessJob, /timeout-minutes: 5/);
  assert.match(readinessJob, /actions: write/);
  assert.match(readinessJob, /contents: read/);
  assert.doesNotMatch(readinessJob, /contents: write/);
  assert.match(rehearsalJob, /github\.event_name == 'pull_request'/);
  assert.match(rehearsalJob, /actions: read/);
  assert.match(rehearsalJob, /contents: read/);
  assert.doesNotMatch(rehearsalJob, /actions: write/);
  assert.match(rehearsalJob, /\*component-release-readiness-check/);
  assert.match(identityJob, /needs: \[readiness, readiness-rehearsal\]/);
  assert.match(identityJob, /needs\.readiness-rehearsal\.outputs\.should_release == 'true'/);
});

test("downstream release jobs require their build dependencies after always()", () => {
  const windowJob = workflow.slice(workflow.indexOf("\n  window:"), workflow.indexOf("\n  native:"));
  const nativeJob = workflow.slice(workflow.indexOf("\n  native:"), workflow.indexOf("\n  report:"));
  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  catch-up:"));
  const catchUp = workflow.slice(workflow.indexOf("\n  catch-up:"));
  const readinessJob = workflow.slice(workflow.indexOf("\n  readiness:"), workflow.indexOf("\n  readiness-rehearsal:"));
  const rehearsalJob = workflow.slice(workflow.indexOf("\n  readiness-rehearsal:"), workflow.indexOf("\n  identity:"));
  assert.match(windowJob, /if: always\(\) && !cancelled\(\) && needs\.identity\.result == 'success' && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\)/);
  assert.match(nativeJob, /if: always\(\) && !cancelled\(\) && needs\.identity\.result == 'success' && needs\.window\.result == 'success' && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\)/);
  assert.match(publishJob, /if: always\(\) && !cancelled\(\) && needs\.identity\.result == 'success' && needs\.native\.result == 'success' && !\(github\.event_name == 'workflow_dispatch' && inputs\.dry_run\)/);
  assert.match(catchUp, /needs\.publish\.result == 'success' \|\| needs\.publish\.result == 'failure' \|\| needs\.readiness\.outputs\.skip_reason == 'cooldown'/);
  assert.match(catchUp, /catch-up-after-failed-publish --latest "\$latest_commit"/);
  assert.match(readinessJob, /actions: write/);
  assert.match(readinessJob, /github\.event_name != 'pull_request'/);
  assert.doesNotMatch(rehearsalJob, /actions: write/);
  assert.equal((workflow.match(/^\s+actions: write\s*$/mg) || []).length, 2);
  assert.doesNotMatch(windowJob, /actions: write/);
  assert.doesNotMatch(nativeJob, /actions: write/);
  assert.doesNotMatch(publishJob, /actions: write/);
});

function failedCapabilityCheck({
  id = 11,
  runId = 506,
  startedAt = "2026-10-08T09:00:00Z",
  conclusion = "failure",
} = {}) {
  return {
    id,
    name: "Capability tests on ubuntu-latest",
    conclusion,
    started_at: startedAt,
    details_url: `https://github.com/KeepOak/Branch-Agent/actions/runs/${runId}/job/99`,
  };
}

function resolveFailedChecks(overrides) {
  const logs = [];
  const decision = resolveFailedReleaseChecks({
    sha: "34f90ad9",
    allowRerun: true,
    sleep: () => {},
    waitMs: 1_000,
    pollMs: 1_000,
    log: message => logs.push(message),
    ...overrides,
  });
  return { decision, logs };
}

test("readiness reruns a first-attempt failed check and proceeds when the rerun passes", () => {
  const reran = [];
  let checks = [failedCapabilityCheck()];
  const runs = {
    506: { id: 506, name: "Capability feature checks", run_attempt: 1, status: "completed", conclusion: "failure" },
  };
  const { decision, logs } = resolveFailedChecks({
    listCheckRuns: () => checks,
    readWorkflowRun: id => runs[id],
    rerunFailedJobs: id => {
      reran.push(id);
      runs[id] = { ...runs[id], run_attempt: 2, status: "completed", conclusion: "success" };
      checks = [failedCapabilityCheck({ id: 12, startedAt: "2026-10-08T09:01:00Z", conclusion: "success" })];
    },
  });
  assert.equal(decision.skip, false);
  assert.equal(decision.failedCount, 0);
  assert.equal(decision.reason, "cleared-after-rerun");
  assert.deepEqual(reran, [506]);
  assert.match(logs.join("\n"), /Rerunning failed jobs for Capability tests on ubuntu-latest \(run 506, attempt 1\)/);
  assert.match(logs.join("\n"), /cleared after rerun/);
});

test("readiness skips when a failed check is still failing after one rerun", () => {
  const reran = [];
  let checks = [failedCapabilityCheck()];
  const runs = {
    506: { id: 506, name: "Capability feature checks", run_attempt: 1, status: "completed", conclusion: "failure" },
  };
  const { decision, logs } = resolveFailedChecks({
    listCheckRuns: () => checks,
    readWorkflowRun: id => runs[id],
    rerunFailedJobs: id => {
      reran.push(id);
      runs[id] = { ...runs[id], run_attempt: 2, status: "completed", conclusion: "failure" };
      checks = [failedCapabilityCheck(), failedCapabilityCheck({ id: 12, startedAt: "2026-10-08T09:01:00Z" })];
    },
  });
  assert.equal(decision.skip, true);
  assert.equal(decision.failedCount, 1);
  assert.equal(decision.reason, "failed-checks");
  assert.deepEqual(reran, [506]);
  assert.match(logs.join("\n"), /still has 1 failed check/);
});

test("readiness does not rerun an already-retried failed run and skips the release", () => {
  const reran = [];
  const { decision, logs } = resolveFailedChecks({
    listCheckRuns: () => [failedCapabilityCheck()],
    readWorkflowRun: () => ({ id: 506, name: "Capability feature checks", run_attempt: 2, status: "completed", conclusion: "failure" }),
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(shouldRerunFailedWorkflow({ run_attempt: 2 }), false);
  assert.equal(decision.skip, true);
  assert.equal(decision.failedCount, 1);
  assert.deepEqual(reran, []);
  assert.equal(decision.reran.length, 0);
  assert.equal(decision.alreadyRetried[0].attempt, 2);
  assert.match(logs.join("\n"), /Not rerunning Capability tests on ubuntu-latest \(run 506\): already attempt 2/);
});

test("pull-request rehearsal counts failed checks and does not rerun them", () => {
  const reran = [];
  const { decision, logs } = resolveFailedChecks({
    allowRerun: false,
    listCheckRuns: () => [failedCapabilityCheck()],
    readWorkflowRun: () => {
      throw new Error("rehearsal should not load workflow runs");
    },
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(decision.skip, true);
  assert.equal(decision.failedCount, 1);
  assert.deepEqual(reran, []);
  assert.match(logs.join("\n"), /pull-request rehearsal only counts them/);
});

test("readiness waits for a rerun to finish before rechecking the SHA", () => {
  let nowMs = 0;
  let reads = 0;
  let checks = [failedCapabilityCheck()];
  const { decision } = resolveFailedChecks({
    now: () => nowMs,
    sleep: ms => { nowMs += ms; },
    waitMs: 4_000,
    pollMs: 1_000,
    listCheckRuns: () => checks,
    readWorkflowRun: () => {
      reads += 1;
      if (reads === 1) return { id: 506, run_attempt: 1, status: "completed", conclusion: "failure" };
      if (reads < 4) return { id: 506, run_attempt: 2, status: "in_progress", conclusion: null };
      checks = [failedCapabilityCheck({ id: 12, startedAt: "2026-10-08T09:01:00Z", conclusion: "success" })];
      return { id: 506, run_attempt: 2, status: "completed", conclusion: "success" };
    },
    rerunFailedJobs: () => {},
  });
  assert.equal(decision.skip, false);
  assert.equal(reads, 4);
  assert.equal(nowMs, 2_000);
});

test("readiness skips when a rerun is still pending after the wait budget", () => {
  let nowMs = 0;
  const reran = [];
  const { decision, logs } = resolveFailedChecks({
    now: () => nowMs,
    sleep: ms => { nowMs += ms; },
    waitMs: 2_000,
    pollMs: 1_000,
    listCheckRuns: () => [failedCapabilityCheck()],
    readWorkflowRun: () => {
      if (reran.length === 0) return { id: 506, run_attempt: 1, status: "completed", conclusion: "failure" };
      return { id: 506, run_attempt: 2, status: "in_progress", conclusion: null };
    },
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(decision.skip, true);
  assert.ok(decision.failedCount > 0);
  assert.equal(decision.reason, "rerun-pending");
  assert.deepEqual(reran, [506]);
  assert.match(logs.join("\n"), /still running; skipping release/);
});

test("readiness skips a later call whose newest check is pending after an earlier same-name failure", () => {
  const reran = [];
  const checks = [
    failedCapabilityCheck({ id: 11, startedAt: "2026-10-08T09:00:00Z" }),
    failedCapabilityCheck({ id: 12, startedAt: "2026-10-08T09:01:00Z", conclusion: null }),
  ];
  const { decision } = resolveFailedChecks({
    listCheckRuns: () => checks,
    readWorkflowRun: () => ({ id: 506, run_attempt: 2, status: "in_progress", conclusion: null }),
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(decision.skip, true);
  assert.ok(decision.failedCount > 0);
  assert.equal(decision.reason, "failed-checks");
  assert.deepEqual(reran, []);
});

test("readiness skips a newest check whose run is already a later in-progress attempt", () => {
  const reran = [];
  const pendingRetry = failedCapabilityCheck({ id: 12, startedAt: "2026-10-08T09:01:00Z", conclusion: null });
  const { decision } = resolveFailedChecks({
    listCheckRuns: () => [pendingRetry],
    readWorkflowRun: () => ({ id: 506, run_attempt: 2, status: "in_progress", conclusion: null }),
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(decision.skip, true);
  assert.ok(decision.failedCount > 0);
  assert.deepEqual(reran, []);
});

test("pending Analyze with no failure does not block", () => {
  const reran = [];
  const reads = [];
  const pending = { id: 8, name: "Analyze (actions)", conclusion: null, status: "in_progress", started_at: "2026-10-08T09:00:00Z" };
  const passed = { id: 9, name: "Desktop on ubuntu-latest", conclusion: "success", status: "completed", started_at: "2026-10-08T09:00:00Z" };
  const { decision } = resolveFailedChecks({
    listCheckRuns: () => [pending, passed],
    readWorkflowRun: id => {
      reads.push(id);
      return { id, run_attempt: 1, status: "in_progress", conclusion: null };
    },
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(failedCheckRuns([pending, passed]).length, 0);
  assert.equal(decision.skip, false);
  assert.equal(decision.failedCount, 0);
  assert.equal(decision.reason, "no-failed-checks");
  assert.deepEqual(reran, []);
  assert.deepEqual(reads, []);
});

test("readiness proceeds without rerunning when there are no failed checks", () => {
  const reran = [];
  const reads = [];
  const pending = { id: 8, name: "Analyze (actions)", conclusion: null, status: "in_progress", started_at: "2026-10-08T09:00:00Z" };
  const passed = { id: 9, name: "Desktop on ubuntu-latest", conclusion: "success", status: "completed", started_at: "2026-10-08T09:00:00Z" };
  const { decision } = resolveFailedChecks({
    listCheckRuns: () => [pending, passed],
    readWorkflowRun: id => {
      reads.push(id);
      return { id, run_attempt: 1, status: "completed", conclusion: "success" };
    },
    rerunFailedJobs: id => reran.push(id),
  });
  assert.equal(failedCheckRuns([pending, passed]).length, 0);
  assert.equal(decision.skip, false);
  assert.equal(decision.failedCount, 0);
  assert.equal(decision.reason, "no-failed-checks");
  assert.deepEqual(reran, []);
  assert.deepEqual(reads, []);
});

test("failed-check rerun wait fits the readiness job timeout and uses the shared gh helper", () => {
  const helperSource = readFileSync(helper, "utf8");
  const calls = [];
  const gh = args => {
    calls.push(args);
    if (String(args[1] ?? "").includes("check-runs")) return JSON.stringify({ total_count: 0, check_runs: [] });
    return JSON.stringify({ id: 9, run_attempt: 1, status: "completed" });
  };
  assert.equal(FAILED_CHECK_RERUN_WAIT_MS, 3 * 60 * 1000);
  assert.equal(FAILED_CHECK_RERUN_POLL_MS, 15 * 1000);
  assert.ok(FAILED_CHECK_RERUN_WAIT_MS < 5 * 60 * 1000);
  assert.match(helperSource, /runGhWithRetry/);
  assert.match(helperSource, /rerun-failed-jobs/);
  assert.match(helperSource, /run_attempt/);
  assert.match(workflow, /MERGE_GATE_WAIT_SECONDS: '240'/);
  listCommitCheckRuns("KeepOak/Branch-Agent", "abc", { gh });
  getWorkflowRun("KeepOak/Branch-Agent", 9, { gh });
  rerunFailedWorkflowJobs("KeepOak/Branch-Agent", 9, { gh });
  assert.ok(calls.every(args => args[0] === "api"));
  assert.ok(calls.some(args => String(args[1]).includes("check-runs")));
  assert.ok(calls.some(args => args.includes("-X") && args.some(part => String(part).includes("rerun-failed-jobs"))));
});

test("native job caches npm, the pnpm store and Electron downloads without changing release timeouts", () => {
  const native = workflow.slice(workflow.indexOf("\n  native:"), workflow.indexOf("\n  report:"));
  assert.ok(native.length > 0);
  assert.match(native, /timeout-minutes: 35/);
  assert.match(native, /cache: npm/);
  assert.match(native, /cache-dependency-path: desktop\/package-lock\.json/);
  assert.match(native, /actions\/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9/);
  assert.match(native, /component-release-pnpm-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ hashFiles\('engine\/pnpm-lock\.yaml'\) \}\}/);
  assert.match(native, /component-release-electron-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ hashFiles\('desktop\/package-lock\.json'\) \}\}/);
  assert.match(native, /Library\/Caches\/electron/);
  assert.match(native, /Library\/Caches\/electron-builder/);
  assert.match(native, /PNPM_STORE_DIR: \$\{\{ github\.workspace \}\}\/\.cache\/pnpm-store/);
  assert.match(native, /ELECTRON_CACHE: \$\{\{ github\.workspace \}\}\/\.cache\/electron/);
  assert.doesNotMatch(native, /package-manager-cache: false/);
});

test("desktop-checks runs readiness as its own node --test step after the desktop build", () => {
  const buildAt = desktopChecks.indexOf("run: npm run build");
  const stepAt = desktopChecks.indexOf("run: node --test scripts/component-release-readiness.test.mjs");
  assert.match(desktopChecks, /^\s+run: node --test scripts\/component-release-readiness\.test\.mjs\s*$/m);
  assert.ok(buildAt >= 0 && stepAt > buildAt);
  assert.doesNotMatch(
    desktopChecks,
    /release-production-layout\.test\.mjs scripts\/component-release-readiness\.test\.mjs/,
  );
});
