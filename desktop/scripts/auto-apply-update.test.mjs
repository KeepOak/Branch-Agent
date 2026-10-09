import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createAutoApplyUpdate, AUTO_APPLY_POLL_MS, AUTO_APPLY_IDLE_MS, AUTO_APPLY_RETRY_MS, AUTO_APPLY_OWNER_AWAY_MS } = await import(
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
    restart: async (version, handoffOnly) => { assert.equal(version, "next"); assert.equal(handoffOnly, true); applied++; }, onApplied: () => {}, log: () => {} });
  await controller.tick(); await controller.tick();
  assert.equal(applied, 1);
  assert.equal(probes, 0);
});

test("failed flagged handoff falls back after idle and notifies once per version", async () => {
  let now = 0; let version = "next"; let activeRuns = 1; const attempts = []; const failures = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => version, enabled: () => true,
    seamlessHandoff: () => true, activity: async () => ({ activeRuns, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async (_version, handoffOnly) => { attempts.push(handoffOnly); throw new Error("standby failed"); },
    onFailure: value => failures.push(value), log: () => {}, now: () => now });
  await controller.tick();
  assert.deepEqual(attempts, [true]);
  assert.deepEqual(failures, []);
  now += 1; await controller.tick();
  assert.deepEqual(attempts, [true], "handoff failure waited the retry back-off before the idle path");
  now += AUTO_APPLY_IDLE_MS; await controller.tick();
  assert.deepEqual(attempts, [true], "fallback interrupted active work");
  activeRuns = 0; await controller.tick();
  now += AUTO_APPLY_IDLE_MS; await controller.tick();
  assert.deepEqual(attempts, [true, false]);
  assert.deepEqual(failures, ["next"]);
  version = "later"; await controller.tick();
  assert.deepEqual(attempts, [true, false, true]);
  assert.deepEqual(failures, ["next"]);
  now += AUTO_APPLY_IDLE_MS; await controller.tick();
  assert.deepEqual(attempts, [true, false, true, false]);
  assert.deepEqual(failures, ["next", "later"]);
});

test("failed flagged handoff falls back after idle without notifying or waiting the retry back-off", async () => {
  let now = 0; const attempts = []; const failures = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    seamlessHandoff: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async (_version, handoffOnly) => {
      attempts.push(handoffOnly);
      if (handoffOnly) throw new Error("A standby is needed to hand off without interrupting running work");
    },
    onFailure: value => failures.push(value), log: () => {}, now: () => now });
  await controller.tick();
  assert.deepEqual(attempts, [true]);
  assert.deepEqual(failures, []);
  now += 1; await controller.tick();
  assert.deepEqual(attempts, [true], "drain ran during the retry back-off window");
  now += AUTO_APPLY_IDLE_MS; await controller.tick();
  assert.deepEqual(attempts, [true, false]);
  assert.deepEqual(failures, []);
});

// Mac low-memory handoff: no standby fits, so the automatic update stops and starts the engine.

test("the in-place notice is only sent when nothing restarted", async () => {
  // Low-memory Mac: the handoff-only attempt finds no standby, then the idle drain stops and starts the engine.
  let now = 0; const applied = []; const restarted = [];
  const drain = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true, seamlessHandoff: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async (_version, handoffOnly) => {
      if (handoffOnly) throw new Error("A standby is needed to hand off without interrupting running work");
      return { restarted: true };
    },
    onApplied: value => applied.push(value), onRestarted: value => restarted.push(value), log: () => {}, now: () => now });
  await drain.tick(); now += AUTO_APPLY_IDLE_MS; await drain.tick();
  assert.deepEqual(applied, [], "a drain restart was announced as \"Nothing restarted\"");
  assert.deepEqual(restarted, ["next"]);
  // A standby took over: nothing restarted, so the in-place notice is true.
  const handoffApplied = []; const handoffRestarted = [];
  const handoff = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true, seamlessHandoff: () => true,
    activity: async () => assert.fail("a handoff never waits for idle"),
    restart: async () => ({ restarted: false }),
    onApplied: value => handoffApplied.push(value), onRestarted: value => handoffRestarted.push(value), log: () => {} });
  await handoff.tick();
  assert.deepEqual(handoffApplied, ["next"]);
  assert.deepEqual(handoffRestarted, []);
  // The swap reports what it did: a non-handoff restart that only kept serving (candidate swap) is in place too.
  const keptApplied = [];
  const kept = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async () => ({ restarted: false }), onApplied: value => keptApplied.push(value),
    onRestarted: () => assert.fail("nothing restarted"), log: () => {}, now: () => now });
  await kept.tick(); now += AUTO_APPLY_IDLE_MS; await kept.tick();
  assert.deepEqual(keptApplied, ["next"]);
});

test("the stop/start restart waits while the owner is using Branch, so the window never goes offline mid-chat", async () => {
  let now = 0; let ownerActiveMsAgo = 5_000; const attempts = []; const logs = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true, seamlessHandoff: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false, ownerActiveMsAgo }),
    restart: async (_version, handoffOnly) => {
      attempts.push(handoffOnly);
      if (handoffOnly) throw new Error("A standby is needed to hand off without interrupting running work");
      return { restarted: true };
    },
    log: line => logs.push(line), now: () => now });
  await controller.tick();
  for (let i = 0; i < 10; i++) { now += AUTO_APPLY_IDLE_MS; ownerActiveMsAgo = 1_000 + i * 6_000; await controller.tick(); }
  assert.deepEqual(attempts, [true], "the engine restarted while the owner was typing in Branch");
  assert.ok(logs.includes("auto-apply: waiting; the owner is using Branch"));
  // Away from Branch long enough (or another app has focus): the idle hold runs from then.
  ownerActiveMsAgo = AUTO_APPLY_OWNER_AWAY_MS; await controller.tick();
  assert.deepEqual(attempts, [true]);
  now += AUTO_APPLY_IDLE_MS; ownerActiveMsAgo = undefined; await controller.tick();
  assert.deepEqual(attempts, [true, false]);
});

test("a restart never starts with a message in flight: typing or a reply at the final check cancels it", async () => {
  let now = 0; let calls = 0; let atFinalCheck = {}; const attempts = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    activity: async () => {
      calls++;
      const idle = { activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false };
      // The second probe of a tick is the fresh snapshot taken right before the stop.
      return calls === 2 ? { ...idle, ...atFinalCheck } : idle;
    },
    restart: async () => { attempts.push(now); return { restarted: true }; }, log: () => {}, now: () => now });
  const tick = async () => { calls = 0; await controller.tick(); };
  await tick(); // the idle hold starts
  for (const inFlight of [{ ownerActiveMsAgo: 0 }, { streaming: true }, { activeRuns: 1 }]) {
    atFinalCheck = inFlight;
    now += AUTO_APPLY_IDLE_MS; await tick(); // past the hold: the final probe sees the message
    assert.deepEqual(attempts, [], `restarted with ${JSON.stringify(inFlight)} at the final check`);
    now += AUTO_APPLY_IDLE_MS; await tick(); // the hold starts over
  }
  atFinalCheck = {};
  now += AUTO_APPLY_IDLE_MS; await tick();
  assert.equal(attempts.length, 1);
});
