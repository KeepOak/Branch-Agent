import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CATCH_UP_MAX_WAIT_MS,
  CATCH_UP_WINDOW_BUFFER_MS,
  PUSH_BACKUP_MIN_AGE_MS,
  decideCatchUp,
  pushBackupShouldRelease,
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
  const checksAt = readiness.indexOf("check-runs");
  assert.ok(windowAt !== -1 && checksAt !== -1 && windowAt < checksAt);
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
  assert.match(catchUp, /needs: \[readiness, publish\]/);
  assert.match(catchUp, /always\(\) && !cancelled\(\)/);
  assert.match(catchUp, /needs\.publish\.result == 'success'/);
  assert.match(catchUp, /needs\.readiness\.outputs\.skip_reason == 'cooldown'/);
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
  assert.equal(workflow.match(/actions: write/g).length, 1);
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
