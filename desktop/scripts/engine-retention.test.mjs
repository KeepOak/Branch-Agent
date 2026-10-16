import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const source = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "engine-retention.js")));
const updates = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update.js")));
const exists = async file => stat(file).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });

async function fixture(run) {
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

test("the previous engine is kept during the healthy probation", async () => fixture(async ({ cfg, previous, current }) => {
  assert.equal(source.PREVIOUS_ENGINE_HEALTHY_MS, 24 * 60 * 60 * 1000);
  const logs = [];
  const now = Date.now();
  await source.recordHealthyEngineLaunch(cfg, join(current, "engine"), now);
  for (const age of [0, 60_000, source.PREVIOUS_ENGINE_HEALTHY_MS - 1]) {
    assert.equal(await source.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + age), false);
    assert.equal(await exists(previous), true, `kept ${age} ms after the first healthy launch`);
  }
  assert.equal(await exists(current), true);
  assert.equal(logs.length, 0);
}));

test("the previous engine is removed after the new engine has run healthy for the window", async () => fixture(async ({ cfg, previous, current }) => {
  const logs = [];
  const now = Date.now();
  await source.recordHealthyEngineLaunch(cfg, join(current, "engine"), now);
  assert.equal(await source.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + source.PREVIOUS_ENGINE_HEALTHY_MS), true);
  assert.equal(await exists(previous), false, "removed once the healthy window ended");
  assert.equal(await exists(current), true);
  assert.equal(await exists(cfg.engineDir), true);
  assert.ok(logs.includes("Update cleanup: the new engine has run healthy; removing the previous rollback copy"));
  assert.equal(await source.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + source.PREVIOUS_ENGINE_HEALTHY_MS + 1), false);
}));

test("rollback still restores the previous engine when the new one fails during probation", async () => fixture(async ({ cfg, previous, current }) => {
  const next = join(current, "engine");
  const prior = join(previous, "engine");
  const logs = [];
  const now = Date.now();
  await writeFile(join(cfg.dataDir, "engine-current.txt"), `${next}\n`);
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({
    version: "0.4.4", phase: "pending", enginePrevious: prior, engineNext: next,
    windowPrevious: join(cfg.dataDir, "window-previous"), windowExisted: false,
  }));
  // A failed new engine never records a healthy launch; even a stale healthy clock must not drop the rollback copy.
  await source.recordHealthyEngineLaunch(cfg, next, now - source.PREVIOUS_ENGINE_HEALTHY_MS - 1);
  assert.equal(await source.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now), false);
  assert.equal(await exists(previous), true, "kept while the update journal is still open");
  assert.equal(await updates.rollbackComponentUpdate(cfg), true);
  assert.equal((await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim(), prior);
  assert.equal(await exists(join(cfg.dataDir, "component-update-pending.json")), false);
  await writeFile(join(cfg.dataDir, "engine-running.txt"), `${prior}\n`);
  await source.recordHealthyEngineLaunch(cfg, prior, now);
  assert.equal(await source.prunePreviousEngineAfterHealth(cfg, line => logs.push(line), now + source.PREVIOUS_ENGINE_HEALTHY_MS + 1), false);
  assert.equal(await exists(previous), true, "never deletes the engine that is running");
  assert.equal(logs.length, 0);
}));
