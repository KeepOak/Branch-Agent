import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createUpdateLock } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "update-lock.js")));
const retention = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "engine-retention.js")));
const updates = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update.js")));
const exists = async file => stat(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });

test("one holder at a time; a second acquire is refused, never queued", async () => {
  const released = [];
  const lock = createUpdateLock(handle => { released.push(handle.purpose); });
  const update = lock.acquire("update 0.5.0");
  assert.ok(update); assert.equal(lock.held, true); assert.equal(lock.purpose, "update 0.5.0");
  assert.equal(lock.acquire("replace the staged update"), undefined);
  assert.equal(lock.holds(update), true);
  await lock.release(update);
  assert.equal(lock.held, false); assert.deepEqual(released, ["update 0.5.0"]);
  // A stale or repeated release never frees someone else's hold.
  const replacing = lock.acquire("replace the staged update");
  await lock.release(update);
  assert.equal(lock.holds(replacing), true); assert.deepEqual(released, ["update 0.5.0"]);
  await lock.release(replacing); await lock.release(replacing);
  assert.deepEqual(released, ["update 0.5.0", "replace the staged update"]);
});

test("Undo (#380) holds the lock across its prepare and the swap; a staged-update replacement is refused throughout", async () => {
  const lock = createUpdateLock();
  const steps = [];
  // As main.ts swapEngineInPlace: a held handle runs the swap under the same hold, anything else is refused.
  const swap = async (held) => {
    if (held ? !lock.holds(held) : lock.held) throw new Error("The desktop is not ready to update");
    const own = held ?? lock.acquire("update");
    try { steps.push("swap"); } finally { if (!held) await lock.release(own); }
  };
  // As main.ts underSwapGuard: resolves undefined while anyone holds the lock.
  const replaceStaged = async () => {
    const own = lock.acquire("replace the staged update");
    if (!own) return undefined;
    try { steps.push("replaced"); return true; } finally { await lock.release(own); }
  };
  const undo = lock.acquire("undo");
  try {
    steps.push("prepare undo");                       // prepareComponentUpdateUndo: the reverse publication
    assert.equal(await replaceStaged(), undefined);    // a newer download never replaces the Undo journal
    await assert.rejects(swap(), /not ready/);         // nor does an Update click start its own swap
    await swap(undo);                                  // Undo's own swap runs under its hold
    assert.equal(await replaceStaged(), undefined);
  } finally { await lock.release(undo); }
  assert.equal(await replaceStaged(), true);
  assert.deepEqual(steps, ["prepare undo", "swap", "replaced"]);
});

async function retentionFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "engine-retention-"));
  const dataDir = join(root, "data");
  const updatesDir = join(dataDir, "updates");
  const previous = join(updatesDir, "release-previous-111aaa");
  const current = join(updatesDir, "release-current-222bbb");
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "bundled-engine") };
  for (const folder of [previous, current, cfg.engineDir, cfg.windowDir]) {
    await mkdir(join(folder, folder === cfg.windowDir ? "" : "engine"), { recursive: true });
  }
  await writeFile(join(previous, "engine", "branch.mjs"), "previous engine\n");
  await writeFile(join(current, "engine", "branch.mjs"), "current engine\n");
  await writeFile(join(cfg.engineDir, "branch.mjs"), "bundled engine\n");
  await writeFile(join(dataDir, "engine-current.txt"), `${join(current, "engine")}\n`);
  await writeFile(join(dataDir, "engine-running.txt"), `${join(current, "engine")}\n`);
  await writeFile(join(dataDir, "component-update-previous.txt"), `${join(previous, "engine")}\n`);
  try { await run({ root, cfg, previous, current }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

test("the previous engine is kept during the healthy probation", async () => retentionFixture(async ({ cfg, previous, current }) => {
  assert.equal(retention.PREVIOUS_ENGINE_HEALTHY_MS, 24 * 60 * 60 * 1000);
  const logs = [];
  const now = Date.now();
  await retention.recordHealthyEngineLaunch(cfg, join(current, "engine"), now);
  for (const age of [0, 60_000, retention.PREVIOUS_ENGINE_HEALTHY_MS - 1]) {
    assert.equal(await retention.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + age), false);
    assert.equal(await exists(previous), true, `kept ${age} ms after the first healthy launch`);
  }
  assert.equal(await exists(current), true);
  assert.equal(logs.length, 0);
}));

test("the previous engine is removed after the new engine has run healthy for the window", async () => retentionFixture(async ({ cfg, previous, current }) => {
  const logs = [];
  const now = Date.now();
  await retention.recordHealthyEngineLaunch(cfg, join(current, "engine"), now);
  assert.equal(await retention.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + retention.PREVIOUS_ENGINE_HEALTHY_MS), true);
  assert.equal(await exists(previous), false, "removed once the healthy window ended");
  assert.equal(await exists(current), true);
  assert.equal(await exists(cfg.engineDir), true);
  assert.ok(logs.includes("Update cleanup: the new engine has run healthy; removing the previous rollback copy"));
  assert.equal(await retention.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + retention.PREVIOUS_ENGINE_HEALTHY_MS + 1), false);
}));

test("rollback still restores the previous engine when the new one fails during probation", async () => retentionFixture(async ({ cfg, previous, current }) => {
  const next = join(current, "engine");
  const prior = join(previous, "engine");
  const logs = [];
  const now = Date.now();
  await writeFile(join(cfg.dataDir, "engine-current.txt"), `${next}\n`);
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({
    version: "0.4.4", phase: "pending", enginePrevious: prior, engineNext: next,
    windowPrevious: join(cfg.dataDir, "window-previous"), windowExisted: false,
  }));
  await retention.recordHealthyEngineLaunch(cfg, next, now - retention.PREVIOUS_ENGINE_HEALTHY_MS - 1);
  assert.equal(await retention.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now), false);
  assert.equal(await exists(previous), true, "kept while the update journal is still open");
  assert.equal(await updates.rollbackComponentUpdate(cfg), true);
  assert.equal((await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim(), prior);
  assert.equal(await exists(join(cfg.dataDir, "component-update-pending.json")), false);
  await writeFile(join(cfg.dataDir, "engine-running.txt"), `${prior}\n`);
  await retention.recordHealthyEngineLaunch(cfg, prior, now);
  assert.equal(await retention.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + retention.PREVIOUS_ENGINE_HEALTHY_MS + 1), false);
  assert.equal(await exists(previous), true, "never deletes the engine that is running");
  assert.equal(logs.length, 0);
}));

