import assert from "node:assert/strict";
import fs, { statfsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createAutoApplyUpdate, readUpdateHealth, updateHealthRefusal, AUTO_APPLY_POLL_MS, AUTO_APPLY_GAP_MS, AUTO_APPLY_RETRY_MS,
  TRUNK_UPDATE_MIN_INTERVAL_MS, TRUNK_WORK_SAMPLE_MS, UPDATE_MIN_FREE_DISK_BYTES, UPDATE_MIN_FREE_MEMORY_BYTES, AUTO_APPLY_SILENT_IDLE_AFTER, updateDiskFloor, AUTO_APPLY_PENDING_CAP_MS, AUTO_APPLY_CHECK_BACKOFF_MAX_MS } = await import(
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
  assert.ok(f.logs.some(line => line.includes("waiting for 2 active runs") && line.includes("retrying in 30s")));
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

async function flushAutoApply() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("awaiting Restart still schedules the next check", async () => {
  const logs = [];
  let polls = 0;
  let tickFn;
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => { polls++; return "0.4.5"; },
    enabled: () => false,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async () => {},
    log: line => logs.push(line),
    interval: fn => { tickFn = fn; return 1; },
    clear: () => {},
  });
  controller.start();
  await flushAutoApply();
  assert.ok(logs.some(line => line.includes("off; awaiting Restart") && line.includes("retrying in 30s")), logs.join("\n"));
  assert.equal(typeof tickFn, "function", "the next check is scheduled while awaiting Restart");
  const before = polls;
  tickFn();
  await flushAutoApply();
  assert.ok(polls > before, `the scheduled check ran while awaiting Restart, got ${polls}`);
  controller.stop();
});

test("after applying a build, awaiting Restart still schedules the next check", async () => {
  // Mac log: a build applied at 08:01 UTC, then `auto-apply: off; awaiting Restart`, then ten hours of silence.
  const logs = [];
  const restarts = [];
  let polls = 0;
  let tickFn;
  let now = 0;
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => { polls++; return "0.4.5"; },
    enabled: () => true,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async version => { restarts.push(version); },
    log: line => logs.push(line),
    now: () => now,
    interval: fn => { tickFn = fn; return 1; },
    clear: () => {},
  });
  await controller.tick();
  now += AUTO_APPLY_GAP_MS - 1;
  await controller.tick();
  assert.deepEqual(restarts, []);
  now += 1;
  await controller.tick();
  assert.deepEqual(restarts, ["0.4.5"], "the build applied in place");
  controller.start();
  await flushAutoApply();
  assert.ok(logs.some(line => line.includes("off; awaiting Restart") && line.includes("retrying in 30s")), logs.join("\n"));
  assert.equal(typeof tickFn, "function", "the next check is scheduled in the awaiting-Restart state");
  const before = polls;
  tickFn();
  await flushAutoApply();
  assert.ok(polls > before, `the next check ran after applying, in the awaiting-Restart state, got ${polls}`);
  controller.stop();
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

for (const [name, health, reason] of [["low-disk", { diskFreeBytes: 1.5 * 1024 ** 3, memoryFree: 0.5 }, /low disk: 1\.5 GB free, the update needs about 2\.0 GB/],
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
  assert.equal(updateHealthRefusal({ diskFree: 0.10, memoryFree: 0.20 }), undefined);
  assert.match(updateHealthRefusal({ diskFree: 0.09, memoryFree: 0.5 }), /low disk: 9% free, under 10%/);
  assert.equal(updateHealthRefusal({ diskFree: 0.01, diskFreeBytes: UPDATE_MIN_FREE_DISK_BYTES, memoryFree: 0.20 }), undefined);
  assert.match(updateHealthRefusal({ diskFree: 0.5, diskFreeBytes: UPDATE_MIN_FREE_DISK_BYTES - 1, memoryFree: 0.5 }), /low disk:/);
  const real = readUpdateHealth(process.cwd(), 4, 16, {});
  const disk = statfsSync(process.cwd());
  assert.ok(Number.isFinite(real.diskFreeBytes) && real.diskFreeBytes >= 0);
  assert.ok(real.diskFreeBytes <= disk.blocks * disk.bsize);
  assert.equal(real.memoryFree, 0.25);
  assert.deepEqual(readUpdateHealth(process.cwd(), 4, 16, { BRANCH_DESKTOP_UPDATE_FREE_DISK: "0.05", BRANCH_DESKTOP_UPDATE_FREE_MEMORY: "0.1" }),
    { diskFree: 0.05, memoryFree: 0.1 });
  const pinned = readUpdateHealth(process.cwd(), 4, 16, { BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES: "3200000000", BRANCH_DESKTOP_UPDATE_FREE_MEMORY: "0.1" });
  assert.equal(pinned.diskFreeBytes, 3_200_000_000);
  assert.equal(pinned.memoryFree, 0.1);
  assert.equal(readUpdateHealth(process.cwd(), 4, 16, { BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES: "0" }).diskFreeBytes, 0);
});

test("87 GB free on a roughly 950 GB drive lets a staged update apply", async (t) => {
  const f = cadence();
  const disk = t.mock.method(fs, "statfsSync", () => ({ bavail: 87_000_000, blocks: 950_000_000, bsize: 1000 }));
  syncBuiltinESMExports();
  try {
    f.state.health = readUpdateHealth("unused", 8 * 1024 ** 3, 16 * 1024 ** 3, {});
  } finally {
    disk.mock.restore();
    syncBuiltinESMExports();
  }
  await f.tick(); f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]]);
});

test("Windows cluster units: 87 GB free of ~950 GB (under 10%) still allows an update", async (t) => {
  const f = cadence();
  const cluster = 4096;
  const freeClusters = 21_240_234;
  const totalClusters = 231_933_594;
  const disk = t.mock.method(fs, "statfsSync", dir => {
    assert.equal(dir, "data-dir");
    return { bavail: freeClusters, blocks: totalClusters, bsize: cluster };
  });
  syncBuiltinESMExports();
  try {
    f.state.health = readUpdateHealth("data-dir", 8 * 1024 ** 3, 16 * 1024 ** 3, {});
  } finally {
    disk.mock.restore();
    syncBuiltinESMExports();
  }
  assert.ok(freeClusters / totalClusters < 0.10, "this volume is under the old 10% rule");
  assert.equal(f.state.health.diskFreeBytes, freeClusters * cluster);
  assert.equal(updateHealthRefusal(f.state.health), undefined);
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

test("repeated probe timeouts leave auto-apply on, back off, then count as idle (Private #1054)", async () => {
  let now = 0; let probes = 0; let enabledReads = 0;
  const restarts = []; const logs = [];
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => "0.4.4-build-next",
    enabled: () => { enabledReads++; return true; },
    activity: async () => { probes++; throw new Error("The window activity check timed out"); },
    restart: async version => { restarts.push(version); },
    log: line => logs.push(line),
    now: () => now,
  });
  assert.equal(AUTO_APPLY_CHECK_BACKOFF_MAX_MS, 5 * 60_000);
  // The first failures back off as before; from the AUTO_APPLY_SILENT_IDLE_AFTER-th they count as idle.
  const waits = [30_000, 60_000];
  assert.equal(waits.length, AUTO_APPLY_SILENT_IDLE_AFTER - 1);
  for (const [i, wait] of waits.entries()) {
    await controller.tick();
    assert.equal(probes, i + 1, "each scheduled retry probes once");
    assert.equal(logs.at(-1), `auto-apply: waiting; activity check failed: The window activity check timed out; retrying in ${wait / 1000} s`);
    now += wait - 1; await controller.tick();
    assert.equal(probes, i + 1, "no probe before the back-off ends");
    now += 1;
  }
  await controller.tick();
  assert.deepEqual(restarts, [], "the idle hold still applies");
  assert.ok(logs.some(line => line.includes("treating the window as idle")), logs.join("\n"));
  now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.ok(enabledReads > 0);
  assert.ok(logs.every(line => !line.includes("off")), logs.join("\n"));
  assert.deepEqual(restarts, ["0.4.4-build-next"]);
});

test("crash recovery holding the update lock postpones auto-apply without turning it off (Private #1054)", async () => {
  let now = 0; let holder = "crash recovery";
  const restarts = []; const logs = [];
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => "0.4.4-build-next",
    enabled: () => true,
    busy: () => holder,
    activity: async () => ({ activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false }),
    restart: async version => { restarts.push(version); },
    log: line => logs.push(line),
    now: () => now,
  });
  await controller.tick(); now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(restarts, []);
  assert.deepEqual(logs, ["auto-apply: waiting; crash recovery in progress; 0.4.4-build-next applies once it ends"]);
  holder = undefined;
  await controller.tick(); now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(restarts, ["0.4.4-build-next"]);
  assert.ok(logs.every(line => !line.includes("off")), logs.join("\n"));
});

test("a lock that appears after the idle gap still postpones before restart (Private #1054)", async () => {
  let now = 0; let holder; let seize = false;
  const restarts = []; const logs = [];
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => "0.4.4-build-next",
    enabled: () => true,
    busy: () => holder,
    activity: async () => {
      if (seize) holder = "replace the staged update";
      return { activeRuns: 0, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false };
    },
    restart: async version => { restarts.push(version); },
    log: line => logs.push(line),
    now: () => now,
  });
  await controller.tick();
  assert.ok(logs.some(line => line.includes("idle hold for 0.4.4-build-next")));
  seize = true;
  now += AUTO_APPLY_GAP_MS;
  await controller.tick();
  assert.deepEqual(restarts, [], "applied while the lock was held");
  assert.ok(logs.some(line => line.includes("waiting; replace the staged update in progress; 0.4.4-build-next applies once it ends")), logs.join("\n"));
  assert.ok(logs.every(line => !line.includes("off")), logs.join("\n"));
  seize = false;
  holder = undefined;
  await controller.tick(); now += AUTO_APPLY_GAP_MS; await controller.tick();
  assert.deepEqual(restarts, ["0.4.4-build-next"]);
});

test("the desktop's auto-apply setting is never tied to the update lock (Private #1054)", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const wiring = main.slice(main.indexOf("const autoApply = createAutoApplyUpdate({"));
  const enabled = /\n  enabled: \(\) => ([^\n]*),\n/.exec(wiring)?.[1];
  assert.equal(enabled, "controls.settings().autoApplyUpdates");
  assert.match(wiring, /\n  busy: \(\) => updateLock\.purpose,\n/);
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

const GB = 1024 ** 3;
test("the disk guard is an absolute floor: a big drive at 9% free still updates", () => {
  // 89.6 GB free on a 952 GB drive is 9.4%: the old percentage rule blocked it forever.
  assert.equal(updateHealthRefusal({ diskFree: 0.094, memoryFree: 0.5, diskFreeBytes: 89.6 * GB, memoryFreeBytes: 8 * GB }), undefined);
  assert.match(updateHealthRefusal({ diskFree: 0.5, memoryFree: 0.5, diskFreeBytes: 1.5 * GB, memoryFreeBytes: 8 * GB }), /low disk: 1\.5 GB free, the update needs about 2\.0 GB/);
  assert.equal(updateDiskFloor(), UPDATE_MIN_FREE_DISK_BYTES);
  assert.equal(updateDiskFloor(1 * GB), 3 * GB, "three times a large update's size");
  assert.match(updateHealthRefusal({ diskFree: 0.5, memoryFree: 0.5, diskFreeBytes: 2.5 * GB, memoryFreeBytes: 8 * GB }, 1 * GB), /the update needs about 3\.0 GB/);
});

test("the memory guard is an absolute floor: 17% of a large RAM still updates", () => {
  assert.equal(updateHealthRefusal({ diskFree: 0.5, memoryFree: 0.17, diskFreeBytes: 50 * GB, memoryFreeBytes: 5.4 * GB }), undefined);
  assert.match(updateHealthRefusal({ diskFree: 0.5, memoryFree: 0.5, diskFreeBytes: 50 * GB, memoryFreeBytes: 0.5 * GB }), /low memory: 0\.5 GB free, under 1\.0 GB/);
  assert.equal(UPDATE_MIN_FREE_MEMORY_BYTES, GB);
});

test("a real health reading carries byte counts, and byte pins override them", () => {
  const real = readUpdateHealth(process.cwd(), 4 * GB, 16 * GB, {});
  assert.ok(real.diskFreeBytes > 0);
  assert.equal(real.memoryFreeBytes, 4 * GB);
  const pinned = readUpdateHealth(process.cwd(), 4 * GB, 16 * GB, { BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES: String(GB), BRANCH_DESKTOP_UPDATE_FREE_MEMORY_BYTES: "0" });
  assert.equal(pinned.diskFreeBytes, GB); assert.equal(pinned.memoryFreeBytes, 0);
  assert.match(updateHealthRefusal(pinned), /low disk/);
});

test("a large host (9% disk, 17% RAM, both plenty in bytes) applies the update", async () => {
  const f = cadence();
  f.state.health = { diskFree: 0.094, memoryFree: 0.17, diskFreeBytes: 89.6 * GB, memoryFreeBytes: 5 * GB };
  await f.tick(); f.state.now += AUTO_APPLY_GAP_MS; await f.tick();
  assert.deepEqual(f.restarts, [["next", true]], f.logs.join("\n"));
});

function silentWindow({ runs = 0 } = {}) {
  let now = 0;
  const restarts = [], logs = [];
  let probes = 0;
  const controller = createAutoApplyUpdate({ pendingVersion: async () => "next", enabled: () => true,
    activity: async () => { probes++; throw new Error("The window activity check timed out"); },
    activeRuns: async () => runs, restart: async version => { restarts.push(version); }, log: line => logs.push(line), now: () => now });
  return { controller, restarts, logs, probes: () => probes, advance: ms => { now += ms; } };
}

test("a window activity check that keeps timing out counts as idle after a few retries", async () => {
  const f = silentWindow();
  for (let i = 0; i < 40 && !f.restarts.length; i++) { await f.controller.tick(); f.advance(AUTO_APPLY_POLL_MS); }
  assert.deepEqual(f.restarts, ["next"], f.logs.join("\n"));
  assert.ok(f.logs.some(line => /activity check failed .*waiting|retrying in/.test(line)), "the first failures still back off");
  assert.ok(f.logs.some(line => line.includes(`activity check failed ${AUTO_APPLY_SILENT_IDLE_AFTER} times`) && line.includes("treating the window as idle")), f.logs.join("\n"));
});

test("a silent window still never interrupts runs the engine reports", async () => {
  const f = silentWindow({ runs: 2 });
  for (let i = 0; i < 40; i++) { await f.controller.tick(); f.advance(AUTO_APPLY_POLL_MS); }
  assert.deepEqual(f.restarts, []);
  assert.ok(f.logs.some(line => line.includes("waiting for 2 active runs")), f.logs.join("\n"));
});
