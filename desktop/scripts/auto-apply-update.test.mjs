import assert from "node:assert/strict";
import fs, { statfsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createAutoApplyUpdate, readUpdateHealth, updateHealthRefusal, AUTO_APPLY_POLL_MS, AUTO_APPLY_GAP_MS, AUTO_APPLY_RETRY_MS,
  TRUNK_UPDATE_MIN_INTERVAL_MS, TRUNK_WORK_SAMPLE_MS, AUTO_APPLY_PENDING_CAP_MS } = await import(
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
  f.advance(AUTO_APPLY_GAP_MS - 1); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  f.advance(1); await f.controller.tick(); await f.controller.tick();
  assert.deepEqual(f.restarts, ["0.4.4-build-test"]);
  assert.ok(f.logs.some(line => line.includes("restarting for 0.4.4-build-test")));
});

test("active runs, approvals, streams, and file drafts reset the idle hold", async () => {
  const f = fixture();
  await f.controller.tick();
  f.setActivity({ activeRuns: 2 }); f.advance(AUTO_APPLY_GAP_MS); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  assert.ok(f.logs.some(line => line.includes("waiting for 2 active runs")));
  f.setActivity({ activeRuns: 0, pendingApprovals: 1 }); await f.controller.tick();
  f.setActivity({ pendingApprovals: 0, streaming: true }); await f.controller.tick();
  f.setActivity({ streaming: false, unsavedDraftFiles: true }); await f.controller.tick();
  f.setActivity({ unsavedDraftFiles: false }); await f.controller.tick();
  f.advance(AUTO_APPLY_GAP_MS); await f.controller.tick();
  assert.equal(f.restarts.length, 1);
});

test("setting off preserves manual Restart and rejected releases are not retried", async () => {
  const f = fixture();
  f.setEnabled(false); await f.controller.tick(); f.advance(AUTO_APPLY_GAP_MS); await f.controller.tick();
  assert.deepEqual(f.restarts, []);
  f.setEnabled(true); f.setVersion(null); await f.controller.tick();
  f.advance(AUTO_APPLY_GAP_MS); await f.controller.tick();
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

test("off Trunk machines, a flagged handoff applies during active work without an idle hold", async () => {
  let applied = 0; let probes = 0;
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    seamlessHandoff: () => true, trunkWork: () => false,
    activity: async () => { probes++; return { activeRuns: 2, pendingApprovals: 1, streaming: true, unsavedDraftFiles: true }; },
    restart: async (version, handoffOnly) => { assert.equal(version, "next"); assert.equal(handoffOnly, true); applied++; }, onApplied: () => {}, log: () => {} });
  await controller.tick(); await controller.tick();
  assert.equal(applied, 1);
  assert.equal(probes, 0);
});

test("failed flagged handoff falls back after idle and notifies once per version", async () => {
  let now = 0; let version = "next"; let activeRuns = 1; const attempts = []; const failures = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => version, enabled: () => true,
    seamlessHandoff: () => true, trunkWork: () => false, activity: async () => ({ activeRuns, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async (_version, handoffOnly) => { attempts.push(handoffOnly); throw new Error("standby failed"); },
    onFailure: value => failures.push(value), log: () => {}, now: () => now });
  await controller.tick();
  assert.deepEqual(attempts, [true]);
  assert.deepEqual(failures, []);
  now += 1; await controller.tick();
  assert.deepEqual(attempts, [true], "handoff failure waited the retry back-off before the idle path");
  now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(attempts, [true], "fallback interrupted active work");
  activeRuns = 0; await controller.tick();
  now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(attempts, [true, false]);
  assert.deepEqual(failures, ["next"]);
  version = "later"; await controller.tick();
  assert.deepEqual(attempts, [true, false, true]);
  assert.deepEqual(failures, ["next"]);
  now += AUTO_APPLY_GAP_MS; await controller.tick();
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
  now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(attempts, [true, false]);
  assert.deepEqual(failures, []);
});

/** A seamless-handoff machine with an injectable clock, activity, health and security flag (Private #951). */
function cadence({ security = false, handoff = true } = {}) {
  const state = { now: 0, version: "next", activity: { activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false },
    health: { diskFreeBytes: 87_000_000_000, memoryFree: 0.5 }, security };
  const restarts = [], drains = [], logs = [];
  const controller = createAutoApplyUpdate({ pendingVersion: async () => state.version, enabled: () => true, seamlessHandoff: () => handoff,
    activity: async () => state.activity, activeRuns: async () => state.activity.activeRuns, health: () => state.health, securityFix: async () => state.security,
    restart: async (version, handoffOnly, drain) => { restarts.push([version, handoffOnly]); if (drain) drains.push(version); }, log: line => logs.push(line), now: () => state.now });
  return { state, restarts, drains, logs, controller, tick: () => controller.tick() };
}

test("an update that arrives mid-run on a Trunk machine hands off at the next gap, not at full idle", async () => {
  const f = cadence();
  f.state.activity = { ...f.state.activity, activeRuns: 1 };
  await f.tick(); assert.deepEqual(f.restarts, [], "applied before the gap hold");
  f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]], "waited for every Trunk to finish instead of a gap");
});

test("a streaming turn is never cut off: it holds the update at every gap, past the cap, without a handoff", async () => {
  const f = cadence({ handoff: false });
  f.state.activity = { activeRuns: 1, pendingApprovals: 0, streaming: true, unsavedDraftFiles: false };
  await f.tick(); f.state.now += AUTO_APPLY_PENDING_CAP_MS + AUTO_APPLY_GAP_MS * 2; await f.tick(); await f.tick();
  assert.deepEqual(f.restarts, [], "a streaming turn was interrupted");
  assert.ok(f.logs.some(line => line.includes("waiting for 1 active runs, 0 approvals, streaming reply")), f.logs.join("\n"));
});

test("a pending update under the cap waits for an idle engine when there is no handoff", async () => {
  const f = cadence({ handoff: false });
  f.state.activity = { ...f.state.activity, activeRuns: 1 };
  await f.tick(); f.state.now += AUTO_APPLY_GAP_MS * 3; await f.tick();
  assert.deepEqual(f.restarts, [], "drained a busy engine before the cap");
  assert.ok(f.logs.some(line => line.includes("waiting for 1 active runs, 0 approvals; no standby to hand off to for next")));
  f.state.activity = { ...f.state.activity, activeRuns: 0 }; await f.tick();
  assert.deepEqual(f.restarts, [["next", false]]);
  assert.deepEqual(f.drains, []);
});

test("a pending update over the cap drains at the next gap when there is no handoff, and logs why", async () => {
  const f = cadence({ handoff: false });
  f.state.activity = { ...f.state.activity, activeRuns: 1 };
  await f.tick(); f.state.now += AUTO_APPLY_PENDING_CAP_MS; await f.tick(); f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", false]], "the capped update never applied");
  assert.deepEqual(f.drains, ["next"], "the capped update did not drain the engine at a gap");
  assert.ok(f.logs.some(line => line.includes("next has been pending over 6 hours; applying at the next gap")), f.logs.join("\n"));
});

test("a pending update over the cap hands off at the next gap on a Trunk machine with a standby", async () => {
  const f = cadence();
  f.state.activity = { ...f.state.activity, activeRuns: 1 };
  await f.tick(); f.state.now += AUTO_APPLY_PENDING_CAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]]);
  assert.deepEqual(f.drains, []);
});

test("a Trunk machine applies at most one update an hour", async () => {
  const f = cadence();
  f.state.activity = { ...f.state.activity, activeRuns: 1 }; await f.tick();
  f.state.activity = { ...f.state.activity, activeRuns: 0 }; await f.tick();
  f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.equal(f.restarts.length, 1);
  f.state.version = "later"; await f.tick();
  f.state.now += AUTO_APPLY_GAP_MS * 10; await f.tick();
  assert.equal(f.restarts.length, 1, "a second update landed within the hour");
  assert.ok(f.logs.some(line => line.includes("batching later with Trunk work")));
  f.state.now = AUTO_APPLY_GAP_MS + TRUNK_UPDATE_MIN_INTERVAL_MS; await f.tick();
  f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts.at(-1), ["later", true]);
});

test("a security fix lands mid-run on a Trunk machine without the batch", async () => {
  const f = cadence({ security: true });
  f.state.activity = { ...f.state.activity, activeRuns: 2 };
  await f.tick();
  assert.deepEqual(f.restarts, [["next", true]]);
});

test("Trunk work seen while nothing is pending batches the next update", async () => {
  const f = cadence();
  f.state.version = null; f.state.activity = { ...f.state.activity, activeRuns: 1 };
  await f.tick();
  f.state.activity = { ...f.state.activity, activeRuns: 0 };
  f.state.now += TRUNK_WORK_SAMPLE_MS; f.state.version = "next"; await f.tick();
  assert.deepEqual(f.restarts, [], "a Trunk machine took an idle update without the hold");
  f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]]);
});

for (const [name, health, reason] of [["low-disk", { diskFreeBytes: 3_200_000_000, memoryFree: 0.5 }, /low disk: 3\.2 GB free, the update needs about 6\.0 GB/],
  ["low-RAM", { diskFreeBytes: 87_000_000_000, memoryFree: 0.19 }, /low memory: 19% free, under 20%/]]) {
  test(`a ${name} host refuses to start an update, a security fix included`, async () => {
    const f = cadence({ security: true });
    f.state.health = health;
    await f.tick(); f.state.now += AUTO_APPLY_GAP_MS * 2; await f.tick(); await f.tick();
    assert.deepEqual(f.restarts, []);
    assert.ok(f.logs.some(line => reason.test(line)), f.logs.join("\n"));
    f.state.health = { diskFreeBytes: 87_000_000_000, memoryFree: 0.5 }; await f.tick();
    assert.deepEqual(f.restarts, [["next", true]]);
  });
}

test("update health reads the data volume and RAM, and tests can pin either", () => {
  assert.equal(updateHealthRefusal({ diskFreeBytes: 6_000_000_000, memoryFree: 0.20 }), undefined);
  assert.match(updateHealthRefusal({ diskFreeBytes: 5_999_999_999, memoryFree: 0.5 }), /low disk:/);
  const real = readUpdateHealth(process.cwd(), 4, 16, {});
  const disk = statfsSync(process.cwd());
  assert.ok(Number.isFinite(real.diskFreeBytes) && real.diskFreeBytes >= 0);
  assert.ok(real.diskFreeBytes <= disk.blocks * disk.bsize);
  assert.equal(real.memoryFree, 0.25);
  assert.deepEqual(readUpdateHealth(process.cwd(), 4, 16, { BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES: "3200000000", BRANCH_DESKTOP_UPDATE_FREE_MEMORY: "0.1" }),
    { diskFreeBytes: 3_200_000_000, memoryFree: 0.1 });
  assert.equal(readUpdateHealth("unused", 4, 16, { BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES: "0" }).diskFreeBytes, 0);
});

test("87 GB free on a roughly 950 GB drive lets a staged update apply", async (t) => {
  const f = cadence();
  const disk = t.mock.method(fs, "statfsSync", () => ({ bavail: 87_000_000, blocks: 950_000_000, bsize: 1000 }));
  syncBuiltinESMExports();
  try {
    f.state.health = readUpdateHealth("unused", 8, 16, {});
  } finally {
    disk.mock.restore();
    syncBuiltinESMExports();
  }
  await f.tick(); f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]]);
});

test("a pending update that keeps being replaced by newer releases still lands once it has waited the cap", async () => {
  // Releases every two hours while a run is always in flight (no standby). The cap counts from the first pending
  // release, so the update lands at the cap instead of waiting for a gap that never comes.
  const f = fixture();
  f.setActivity({ activeRuns: 1 });
  const step = AUTO_APPLY_POLL_MS, release = 2 * 60 * 60_000;
  for (let t = 0, n = 0; t <= AUTO_APPLY_PENDING_CAP_MS + 2 * AUTO_APPLY_GAP_MS; t += step) {
    if (t % release === 0) f.setVersion(`0.4.4-build-${n++}`);
    await f.controller.tick();
    f.advance(step);
  }
  assert.ok(f.restarts.length >= 1, "the capped update drained at a gap");
  assert.match(f.restarts[0], /^0\.4\.4-build-\d+$/);
});

// Private #1054 M5: a staged desktop shell applies by itself at the next gap with no run in flight, by one quit and
// relaunch through the update helper, with the window or tray kept as it was.
const { createShellRelaunch, relaunchArgs } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "shell-relaunch.js")));
const { START_IN_TRAY } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "desktop-os.js")));

function shellFixture({ staged = "0.4.6", trunkWork = false, windowShown = false, handed = true } = {}) {
  let now = 0;
  let version = staged;
  let activity = { activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false };
  const restarts = []; const handOffs = []; const logs = []; let quits = 0; let tick;
  const relaunch = createShellRelaunch({
    handOff: async args => { handOffs.push(args); return handed; },
    quit: () => { quits++; },
    argv: ["--flag"], windowShown: () => windowShown, platform: "win32", log: line => logs.push(line),
  });
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => version, enabled: () => true,
    // A standby exists for engine updates; a desktop shell must never be offered to it.
    seamlessHandoff: () => true, relaunchesApp: () => true, trunkWork: () => trunkWork,
    activity: async () => activity,
    restart: async (value, handoffOnly, drain) => { restarts.push([value, handoffOnly, drain ?? false]); if (handoffOnly) throw new Error("no standby for a shell"); await relaunch(); },
    log: line => logs.push(line), now: () => now,
    interval: fn => { tick = fn; return 1; }, clear: () => {},
  });
  const run = async (ticks, stepMs = AUTO_APPLY_POLL_MS) => { for (let i = 0; i < ticks; i++) { now += stepMs; await controller.tick(); } };
  return { controller, restarts, handOffs, logs, run, quits: () => quits, relaunch, startTick: () => tick,
    setVersion: value => { version = value; }, setActivity: value => { activity = { ...activity, ...value }; } };
}

test("M5 (a): a staged desktop shell never relaunches while a run is active, even past the pending cap", async () => {
  const f = shellFixture();
  // A helper run with nothing streaming still counts (Private #1454): the relaunch would stop it.
  f.setActivity({ activeRuns: 1 });
  await f.controller.tick();
  await f.run(10);
  await f.run(1, AUTO_APPLY_PENDING_CAP_MS);
  await f.run(10);
  assert.deepEqual(f.restarts, [], "no quit and relaunch while a run is in flight");
  assert.deepEqual(f.handOffs, []);
  assert.equal(f.quits(), 0);
  assert.ok(f.logs.some(line => line.includes("waiting for 1 active runs")));
  // The run ends: the gap starts only now, and the relaunch waits the full gap.
  f.setActivity({ activeRuns: 0 });
  await f.controller.tick();
  assert.equal(f.quits(), 0, "a run that just ended starts the gap; it does not relaunch at once");
});

test("M5 (a): on a Trunk machine a staged shell keeps the hourly batch (Private #1428)", async () => {
  const g = shellFixture({ trunkWork: true });
  await g.controller.tick(); await g.run(4);
  assert.equal(g.quits(), 1, "the first staged shell applies at a gap");
  // A newer shell staged minutes later waits for the hour, then for a gap.
  g.setVersion("0.4.7");
  await g.run(10);
  assert.equal(g.restarts.length, 1, "no second relaunch inside the hour");
  assert.ok(g.logs.some(line => line.includes("batching 0.4.7 with Trunk work")));
});

test("M5 (b): going idle schedules exactly one quit and relaunch through the update helper, keeping the tray", async () => {
  const f = shellFixture({ windowShown: false });
  f.controller.start();
  const tick = f.startTick();
  assert.equal(typeof tick, "function", "auto-apply polls on its own interval");
  await f.run(20);
  assert.deepEqual(f.restarts, [["0.4.6", false, false]], "one relaunch, never a standby handoff and never a drain");
  assert.equal(f.handOffs.length, 1, "the update helper is handed the swap once");
  assert.deepEqual(f.handOffs[0], ["--flag", START_IN_TRAY], "a tray-only app relaunches quietly in the tray");
  assert.equal(f.quits(), 1);
  await f.relaunch();
  assert.equal(f.handOffs.length, 1, "a second request while quitting does nothing");
  f.controller.stop();

  const open = shellFixture({ windowShown: true });
  await open.controller.tick(); await open.run(4);
  assert.deepEqual(open.handOffs, [["--flag"]], "a window the owner had open opens again");
});

test("M5 (c): nothing relaunches without a staged desktop shell", async () => {
  const f = shellFixture({ staged: null });
  await f.controller.tick();
  await f.run(20);
  assert.deepEqual(f.restarts, []);
  assert.deepEqual(f.handOffs, []);
  assert.equal(f.quits(), 0);
  // The helper finds nothing staged: the app keeps running instead of quitting.
  let quits = 0;
  const relaunch = createShellRelaunch({ handOff: async () => false, quit: () => { quits++; }, argv: [], windowShown: () => false, log: () => {} });
  await assert.rejects(relaunch(), /could not be handed/);
  assert.equal(quits, 0);
});

test("M5: relaunch arguments keep the window or tray state on Windows only", () => {
  assert.deepEqual(relaunchArgs([START_IN_TRAY, "--x"], true, "win32"), ["--x"]);
  assert.deepEqual(relaunchArgs([START_IN_TRAY, "--x"], false, "win32"), ["--x", START_IN_TRAY]);
  assert.deepEqual(relaunchArgs(["--x"], false, "darwin"), ["--x"]);
});
