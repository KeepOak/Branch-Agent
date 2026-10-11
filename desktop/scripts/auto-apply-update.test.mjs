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


// Safe updates (snapshot preflight): the staged engine boots on a copy of the real data before any switch.
const { runSnapshotPreflight, engineRehearsal, repairLiveState, parseRehearsalReport, ownerRefusalLine } = await import(
  pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "snapshot-preflight.js"))
);
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { createServer } = await import("node:http");

const passed = { outcome: "passed", policy: "startup-only", phase: "readiness" };
const refusedAtStartup = { outcome: "refused", policy: "startup-only", phase: "startup", failedStep: "candidate-gateway-startup",
  detail: "invalid persisted session row requires repair for agent:main:broken" };

test("snapshot preflight: a copy that starts as-is switches with no repair", async () => {
  const calls = [];
  const outcome = await runSnapshotPreflight("1.2.3", async repair => { calls.push(repair); return passed; }, () => {});
  assert.deepEqual(outcome, { kind: "pass" });
  assert.deepEqual(calls, [false]);
});

test("snapshot preflight: a refusing copy that Doctor repairs plans the live repair; one it cannot repair keeps the old engine", async () => {
  const repaired = await runSnapshotPreflight("1.2.3", async repair => repair ? { ...passed, policy: "rehearse" } : refusedAtStartup, () => {});
  assert.deepEqual(repaired, { kind: "repair", detail: refusedAtStartup.detail });
  const logs = [];
  const refused = await runSnapshotPreflight("1.2.3", async repair => repair ? { ...refusedAtStartup, policy: "rehearse" } : refusedAtStartup, line => logs.push(line));
  assert.deepEqual(refused, { kind: "refuse", line: ownerRefusalLine("1.2.3") });
  assert.equal(refused.line.includes("\n"), false, "the owner gets exactly one line");
  assert.equal(refused.line.includes("doctor"), false, "the engine's raw error stays in the log");
  assert.ok(logs.some(line => line.includes("requires repair")));
});

test("snapshot preflight: an older candidate or a copy that cannot be made falls back to the scratch check", async () => {
  assert.equal((await runSnapshotPreflight("1.2.3", async () => undefined, () => {})).kind, "unavailable");
  const noSpace = { outcome: "refused", policy: "startup-only", phase: "snapshot", detail: "snapshot-capacity-insufficient" };
  assert.deepEqual(await runSnapshotPreflight("1.2.3", async () => noSpace, () => {}), { kind: "unavailable", reason: "snapshot: snapshot-capacity-insufficient" });
  const calls = [];
  const runtimeCheck = { outcome: "refused", policy: "startup-only", phase: "runtime", failedStep: "candidate-recovery", detail: "no runtime" };
  assert.equal((await runSnapshotPreflight("1.2.3", async repair => { calls.push(repair); return runtimeCheck; }, () => {})).kind, "unavailable");
  assert.deepEqual(calls, [false], "only a copy that refused to start is worth a repair attempt");
  assert.equal(parseRehearsalReport("error: unknown command 'rehearse'\n"), undefined);
  assert.deepEqual(parseRehearsalReport("progress\n" + JSON.stringify(passed) + "\n"), passed);
});

/**
 * Fixture host: a live state dir whose session store holds one invalid row, a stand-in staged engine that follows the
 * engine's contract (update rehearse: copy the state, validate the copy like a start, --repair runs Doctor on the
 * copy; doctor --fix: repair live), and the old engine serving HTTP the whole time.
 */
function fixtureHost(invalidRow) {
  const root = mkdtempSync(join(tmpdir(), "branch-safe-update-"));
  const stateDir = join(root, "state"), engineDir = join(root, "engine");
  mkdirSync(stateDir); mkdirSync(engineDir);
  const sessions = [{ key: "agent:main:main", valid: true }, { key: "agent:main:broken", valid: false, ...invalidRow }];
  writeFileSync(join(stateDir, "sessions.json"), JSON.stringify(sessions));
  writeFileSync(join(engineDir, "branch.mjs"), `
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const args = process.argv.slice(2), live = process.env.BRANCH_STATE_DIR;
const repair = rows => rows.map(row => row.valid || !row.repairable ? row : { ...row, valid: true });
const bad = rows => rows.find(row => !row.valid);
if (args[0] === "update" && args[1] === "rehearse") {
  const copy = mkdtempSync(join(tmpdir(), "rehearsal-"));
  cpSync(live, copy, { recursive: true });
  let rows = JSON.parse(readFileSync(join(copy, "sessions.json"), "utf8"));
  if (args.includes("--repair")) { rows = repair(rows); writeFileSync(join(copy, "sessions.json"), JSON.stringify(rows)); }
  const row = bad(rows);
  console.log(JSON.stringify(row
    ? { outcome: "refused", policy: args.includes("--repair") ? "rehearse" : "startup-only", phase: "startup", failedStep: "candidate-gateway-startup",
        detail: "invalid persisted session row requires repair for " + row.key }
    : { outcome: "passed", policy: args.includes("--repair") ? "rehearse" : "startup-only", phase: "readiness" }));
  process.exit(row ? 1 : 0);
}
if (args[0] === "doctor" && args.includes("--fix")) {
  const rows = repair(JSON.parse(readFileSync(join(live, "sessions.json"), "utf8")));
  writeFileSync(join(live, "sessions.json"), JSON.stringify(rows));
  if (bad(rows)) { console.error("could not repair " + bad(rows).key); process.exit(1); }
  process.exit(0);
}
console.error("error: unknown command"); process.exit(1);
`);
  return { root, stateDir, engineDir, live: () => readFileSync(join(stateDir, "sessions.json"), "utf8"),
    command: { nodePath: process.execPath, engineDir, env: { ...process.env, BRANCH_STATE_DIR: stateDir }, timeoutMs: 30_000 },
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The old engine: answers /readyz throughout; the probe records every answer while the preflight runs. */
async function servingOldEngine() {
  const server = createServer((_req, res) => { res.end("ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/readyz";
  let failures = 0, answers = 0, stop = false;
  const probing = (async () => {
    while (!stop) {
      try { (await fetch(url)).ok ? answers++ : failures++; } catch { failures++; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  })();
  return { async close() { stop = true; await probing; await new Promise(resolve => server.close(resolve)); return { answers, failures }; } };
}

test("fixture host with one invalid session row: repaired on the copy, then on live, with the old engine serving throughout", async () => {
  const host = fixtureHost({ repairable: true });
  const oldEngine = await servingOldEngine();
  try {
    const before = host.live();
    const outcome = await runSnapshotPreflight("1.2.3", engineRehearsal(host.command), () => {});
    assert.deepEqual(outcome, { kind: "repair", detail: "invalid persisted session row requires repair for agent:main:broken" });
    assert.equal(host.live(), before, "the preflight only read the live state");
    const served = await oldEngine.close();
    assert.equal(served.failures, 0, "the old engine never stopped answering during the preflight");
    assert.ok(served.answers > 0);
    // Maintenance window of the swap: the repair proven on the copy is applied to live.
    assert.deepEqual(await repairLiveState(host.command), { ok: true });
    assert.equal(JSON.parse(host.live()).every(row => row.valid), true);
    assert.equal((await runSnapshotPreflight("1.2.3", engineRehearsal(host.command), () => {})).kind, "pass");
  } finally { await oldEngine.close().catch(() => {}); host.cleanup(); }
});

test("fixture host with one invalid session row Doctor cannot repair: the update is refused and the old engine keeps serving", async () => {
  const host = fixtureHost({ repairable: false });
  const oldEngine = await servingOldEngine();
  try {
    const before = host.live();
    const outcome = await runSnapshotPreflight("1.2.3", engineRehearsal(host.command), () => {});
    assert.equal(outcome.kind, "refuse");
    assert.equal(outcome.line, ownerRefusalLine("1.2.3"));
    assert.equal(host.live(), before, "nothing touched the live state");
    const served = await oldEngine.close();
    assert.equal(served.failures, 0, "the old engine never stopped answering");
    assert.ok(served.answers > 0);
  } finally { await oldEngine.close().catch(() => {}); host.cleanup(); }
});

test("a live repair that fails reports its last line so the swap restores the serving engine", async () => {
  const host = fixtureHost({ repairable: false });
  try {
    assert.deepEqual(await repairLiveState(host.command), { ok: false, detail: "could not repair agent:main:broken" });
  } finally { host.cleanup(); }
});

