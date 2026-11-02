import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// A staged update while nothing runs and no window can report approvals or drafts: it must not wait forever.
if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const mod = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "auto-apply-update.js")));
const { createAutoApplyUpdate, AUTO_APPLY_GAP_MS, AUTO_APPLY_POLL_MS } = mod;
const UNKNOWN_IDLE_MS = mod.AUTO_APPLY_UNKNOWN_IDLE_MS ?? 10 * 60_000;
const UNKNOWN = { activeRuns: 0, pendingApprovals: null, streaming: false, unsavedDraftFiles: null };

function fixture(extra = {}) {
  let now = 0;
  let activity = { ...UNKNOWN };
  const restarts = [];
  const logs = [];
  const controller = createAutoApplyUpdate({
    pendingVersion: async () => "next",
    enabled: () => true,
    trunkWork: () => false,
    activity: async () => activity,
    restart: async (version, handoffOnly, drain) => { restarts.push({ version, handoffOnly, drain: Boolean(drain) }); },
    log: line => logs.push(line),
    now: () => now,
    ...extra,
  });
  /** Ticks every poll interval for ms milliseconds. */
  const run = async ms => {
    for (let spent = 0; spent <= ms; spent += AUTO_APPLY_POLL_MS) { await controller.tick(); now += AUTO_APPLY_POLL_MS; }
  };
  return { controller, restarts, logs, run, set: value => { activity = { ...activity, ...value }; } };
}

test("nothing running and nothing readable: the staged update applies on its own after the unknown wait", async () => {
  const f = fixture();
  await f.run(UNKNOWN_IDLE_MS + 2 * AUTO_APPLY_GAP_MS);
  assert.deepEqual(f.restarts, [{ version: "next", handoffOnly: false, drain: false }], f.logs.join("\n"));
});

test("while it waits, the log says plainly what it waits for and when it applies anyway", async () => {
  const f = fixture();
  await f.run(AUTO_APPLY_GAP_MS);
  assert.deepEqual(f.restarts, []);
  const line = f.logs.find(entry => entry.includes("unknown approvals"));
  assert.ok(line, f.logs.join("\n"));
  assert.match(line, /no window could report approvals or drafts/);
  assert.match(line, /next applies once nothing has run for 10 minutes/);
  assert.equal(f.logs.filter(entry => entry.includes("unknown approvals")).length, 1, "the waiting line is not repeated every check");
  await f.run(UNKNOWN_IDLE_MS + 2 * AUTO_APPLY_GAP_MS);
  assert.ok(f.logs.some(entry => /approvals and drafts unknown for 10 minutes with nothing running; counting them as none for next/.test(entry)), f.logs.join("\n"));
});

test("a run in flight keeps the update waiting however long approvals stay unknown", async () => {
  const f = fixture();
  f.set({ activeRuns: 1 });
  await f.run(3 * UNKNOWN_IDLE_MS);
  assert.deepEqual(f.restarts, []);
});

test("a streaming reply keeps the update waiting however long approvals stay unknown", async () => {
  const f = fixture();
  f.set({ streaming: true });
  await f.run(3 * UNKNOWN_IDLE_MS);
  assert.deepEqual(f.restarts, []);
});

test("a known pending approval or unsaved draft is never timed out", async () => {
  const approval = fixture();
  approval.set({ pendingApprovals: 1, unsavedDraftFiles: null });
  await approval.run(3 * UNKNOWN_IDLE_MS);
  assert.deepEqual(approval.restarts, []);
  const draft = fixture();
  draft.set({ pendingApprovals: null, unsavedDraftFiles: true });
  await draft.run(3 * UNKNOWN_IDLE_MS);
  assert.deepEqual(draft.restarts, []);
});

test("a run during the unknown wait starts the 10 minutes again", async () => {
  const f = fixture();
  await f.run(UNKNOWN_IDLE_MS - 2 * AUTO_APPLY_POLL_MS);
  f.set({ activeRuns: 1 });
  await f.run(AUTO_APPLY_POLL_MS);
  f.set({ activeRuns: 0 });
  await f.run(UNKNOWN_IDLE_MS - 2 * AUTO_APPLY_POLL_MS);
  assert.deepEqual(f.restarts, [], "applied before nothing had run for a full 10 minutes");
  await f.run(4 * AUTO_APPLY_GAP_MS);
  assert.equal(f.restarts.length, 1, f.logs.join("\n"));
});

test("a staged desktop app that relaunches also applies after the unknown wait", async () => {
  const f = fixture({ relaunchesApp: () => true });
  await f.run(UNKNOWN_IDLE_MS + 2 * AUTO_APPLY_GAP_MS);
  assert.equal(f.restarts.length, 1, f.logs.join("\n"));
});
