import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createAutoApplyUpdate, AUTO_APPLY_POLL_MS, AUTO_APPLY_IDLE_MS, AUTO_APPLY_RETRY_MS } = await import(
  pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "auto-apply-update.js"))
);
const { COMPONENT_UPDATE_CHECK_MS } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update.js")));

function fixture() {
  let now = 0;
  let version = "0.4.4-build-test";
  let enabled = true;
  let activity = { activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false };
  const restarts = [];
  const logs = [];
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => version,
    enabled: () => enabled,
    activity: async () => activity,
    restart: async value => { restarts.push(value); },
    log: line => logs.push(line),
    now: () => now,
  });
  return { controller, restarts, logs, advance: ms => { now += ms; }, setVersion: value => { version = value; },
    setEnabled: value => { enabled = value; }, setActivity: value => { activity = { ...activity, ...value }; } };
}

test("staged update relaunches once after a sustained idle hold", async () => {
  const f = fixture();
  await f.controller.tick();
  f.advance(AUTO_APPLY_IDLE_MS - 1); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  f.advance(1); await f.controller.tick(); await f.controller.tick();
  assert.deepEqual(f.restarts, ["0.4.4-build-test"]);
  assert.ok(f.logs.some(line => line.includes("restarting for 0.4.4-build-test")));
});

test("active runs, approvals, streams, and file drafts reset the idle hold", async () => {
  const f = fixture();
  await f.controller.tick();
  f.setActivity({ activeRuns: 2 }); f.advance(AUTO_APPLY_IDLE_MS); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  assert.ok(f.logs.some(line => line.includes("waiting for 2 active runs")));
  f.setActivity({ activeRuns: 0, pendingApprovals: 1 }); await f.controller.tick();
  f.setActivity({ pendingApprovals: 0, streaming: true }); await f.controller.tick();
  f.setActivity({ streaming: false, unsavedDraftFiles: true }); await f.controller.tick();
  f.setActivity({ unsavedDraftFiles: false }); await f.controller.tick();
  f.advance(AUTO_APPLY_IDLE_MS); await f.controller.tick();
  assert.equal(f.restarts.length, 1);
});

test("setting off preserves manual Restart and rejected releases are not retried", async () => {
  const f = fixture();
  f.setEnabled(false); await f.controller.tick(); f.advance(AUTO_APPLY_IDLE_MS); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  f.setEnabled(true); f.setVersion(null); await f.controller.tick();
  f.advance(AUTO_APPLY_IDLE_MS); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
});

test("staged idle is rechecked every 30 seconds and releases every ten minutes", () => {
  let scheduled;
  const controller = createAutoApplyUpdate({ pendingVersion: async () => null, enabled: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async () => {}, log: () => {}, interval: (_tick, ms) => { scheduled = ms; return 1; }, clear: () => {} });
  controller.start(); controller.stop();
  assert.equal(AUTO_APPLY_POLL_MS, 30_000);
  assert.equal(scheduled, 30_000);
  assert.equal(COMPONENT_UPDATE_CHECK_MS, 10 * 60 * 1000);
});

test("flagged handoff applies during active work without an idle hold", async () => {
  let applied = 0; let probes = 0;
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    seamlessHandoff: () => true,
    activity: async () => { probes++; return { activeRuns: 2, pendingApprovals: 1, streaming: true, unsavedDraftFiles: true }; },
    restart: async version => { assert.equal(version, "next"); applied++; }, onApplied: () => {}, log: () => {} });
  await controller.tick(); await controller.tick();
  assert.equal(applied, 1);
  assert.equal(probes, 0);
});

test("failed flagged handoff retries after backoff and notifies once per version", async () => {
  let now = 0; let attempts = 0; let version = "next"; const failures = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => version, enabled: () => true,
    seamlessHandoff: () => true, activity: async () => { throw new Error("idle probe must not run"); },
    restart: async () => { attempts++; throw new Error("standby failed"); },
    onFailure: value => failures.push(value), log: () => {}, now: () => now });
  await controller.tick(); await controller.tick();
  assert.equal(attempts, 1); assert.deepEqual(failures, ["next"]);
  now += AUTO_APPLY_RETRY_MS; await controller.tick();
  assert.equal(attempts, 2); assert.deepEqual(failures, ["next"]);
  version = "later"; await controller.tick();
  assert.deepEqual(failures, ["next", "later"]);
});
