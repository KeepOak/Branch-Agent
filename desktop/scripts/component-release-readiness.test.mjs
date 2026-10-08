import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PUSH_BACKUP_MIN_AGE_MS, pushBackupShouldRelease } from "./component-release-readiness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(join(here, "../../.github/workflows/component-release.yml"), "utf8").replace(/\r\n/g, "\n");
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
  assert.doesNotMatch(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /node desktop\/scripts\/component-release-readiness\.mjs/);
  assert.match(workflow, /more than 25 minutes old/);
  assert.match(workflow, /GITHUB_EVENT_NAME" == "push"/);
});
