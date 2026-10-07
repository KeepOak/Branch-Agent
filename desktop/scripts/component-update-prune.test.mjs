import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { pruneOldReleases, checkDiskSpace } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-prune.js")));

async function makeRelease(updates, name, complete = true) {
  const folder = join(updates, name);
  await mkdir(join(folder, "engine", "dist"), { recursive: true });
  await writeFile(join(folder, "engine", "branch.mjs"), "");
  await writeFile(join(folder, "engine", "package.json"), "{}");
  await writeFile(join(folder, "engine", "dist", "build-info.json"), "{}");
  if (complete) await writeFile(join(folder, ".release-complete"), "");
  return folder;
}

async function fixture(run) {
  const parent = join(tmpdir(), "Codex-session-files", "prune-test-20261007");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const dataDir = join(root, "data");
  const updates = join(dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "old-engine") };
  
  try { await run({ root, cfg, updates }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

test("prune keeps current and previous builds after apply", async () => fixture(async ({ cfg, updates }) => {
  const release1 = await makeRelease(updates, "release-0.4.1-build-abc123-A1B2C3");
  const release2 = await makeRelease(updates, "release-0.4.2-build-def456-D4E5F6");
  const release3 = await makeRelease(updates, "release-0.4.3-build-ghi789-G7H8I9");
  const release4 = await makeRelease(updates, "release-0.4.4-build-jkl012-J0K1L2");
  const release5 = await makeRelease(updates, "release-0.4.5-build-mno345-M3N4O5");
  
  const current = join(release5, "engine");
  const previous = join(release4, "engine");
  
  const failures = [];
  await pruneOldReleases(cfg, current, previous, undefined, error => failures.push(error));
  
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.5-build-mno345-M3N4O5"), "current kept");
  assert.ok(remaining.includes("release-0.4.4-build-jkl012-J0K1L2"), "previous kept");
  assert.ok(!remaining.includes("release-0.4.1-build-abc123-A1B2C3"), "old release 1 pruned");
  assert.ok(!remaining.includes("release-0.4.2-build-def456-D4E5F6"), "old release 2 pruned");
  assert.ok(!remaining.includes("release-0.4.3-build-ghi789-G7H8I9"), "old release 3 pruned");
}));

test("prune never deletes active or staged build", async () => fixture(async ({ cfg, updates }) => {
  const release1 = await makeRelease(updates, "release-0.4.1-build-abc123-A1B2C3");
  const release2 = await makeRelease(updates, "release-0.4.2-build-def456-D4E5F6");
  const release3 = await makeRelease(updates, "release-0.4.3-build-ghi789-G7H8I9");
  const staged = await makeRelease(updates, "release-0.4.4-build-jkl012-J0K1L2");
  
  await writeFile(join(cfg.dataDir, "engine-running.txt"), join(release2, "engine") + "\n");
  
  const current = join(release3, "engine");
  const previous = join(release1, "engine");
  const pendingEngine = join(staged, "engine");
  
  const failures = [];
  await pruneOldReleases(cfg, current, previous, pendingEngine, error => failures.push(error));
  
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.1-build-abc123-A1B2C3"), "previous kept");
  assert.ok(remaining.includes("release-0.4.2-build-def456-D4E5F6"), "running kept");
  assert.ok(remaining.includes("release-0.4.3-build-ghi789-G7H8I9"), "current kept");
  assert.ok(remaining.includes("release-0.4.4-build-jkl012-J0K1L2"), "staged kept");
}));

test("prune skips incomplete downloads without failing", async () => fixture(async ({ cfg, updates }) => {
  const release1 = await makeRelease(updates, "release-0.4.1-build-abc123-A1B2C3");
  const incomplete = await makeRelease(updates, "release-0.4.2-build-def456-D4E5F6", false);
  const release3 = await makeRelease(updates, "release-0.4.3-build-ghi789-G7H8I9");
  
  const current = join(release3, "engine");
  const previous = "";
  
  const failures = [];
  await pruneOldReleases(cfg, current, previous, undefined, error => failures.push(error));
  
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.3-build-ghi789-G7H8I9"), "current kept");
  assert.ok(remaining.includes("release-0.4.2-build-def456-D4E5F6"), "incomplete download kept");
  assert.ok(!remaining.includes("release-0.4.1-build-abc123-A1B2C3"), "old complete release pruned");
}));

test("prune cleans trash folders from previous failed deletes", async () => fixture(async ({ cfg, updates }) => {
  const release = await makeRelease(updates, "release-0.4.3-build-ghi789-G7H8I9");
  const trash1 = join(updates, ".trash-release-0.4.1-build-abc123-A1B2C3-12345-abc");
  const trash2 = join(updates, ".trash-release-0.4.2-build-def456-D4E5F6-67890-def");
  await mkdir(trash1, { recursive: true });
  await mkdir(trash2, { recursive: true });
  
  const current = join(release, "engine");
  
  const failures = [];
  await pruneOldReleases(cfg, current, "", undefined, error => failures.push(error));
  
  const remaining = await readdir(updates);
  assert.ok(!remaining.includes(".trash-release-0.4.1-build-abc123-A1B2C3-12345-abc"), "trash 1 cleaned");
  assert.ok(!remaining.includes(".trash-release-0.4.2-build-def456-D4E5F6-67890-def"), "trash 2 cleaned");
}));

test("launch prune cleans an already-full folder", async () => fixture(async ({ cfg, updates }) => {
  for (let i = 1; i <= 10; i++) {
    await makeRelease(updates, `release-0.4.${i}-build-abc${i.toString().padStart(3, "0")}-X${i}Y${i}Z${i}`);
  }
  
  const latest = join(updates, "release-0.4.10-build-abc010-X10Y10Z10", "engine");
  const prev = join(updates, "release-0.4.9-build-abc009-X9Y9Z9", "engine");
  await writeFile(join(cfg.dataDir, "engine-current.txt"), latest + "\n");
  
  const failures = [];
  await pruneOldReleases(cfg, latest, prev, undefined, error => failures.push(error));
  
  const remaining = await readdir(updates);
  assert.equal(remaining.filter(n => n.startsWith("release-")).length, 2, "only 2 releases remain");
  assert.ok(remaining.includes("release-0.4.10-build-abc010-X10Y10Z10"), "latest kept");
  assert.ok(remaining.includes("release-0.4.9-build-abc009-X9Y9Z9"), "previous kept");
}));

test("disk space check returns enough=true when space available", async () => {
  const result = await checkDiskSpace(tmpdir(), 1024 * 1024);
  assert.equal(typeof result.enough, "boolean");
  assert.ok(result.enough || result.message, "either enough or has message");
});

test("disk space check estimates with margin", async () => {
  const result = await checkDiskSpace(tmpdir(), 100 * 1024 * 1024 * 1024);
  if (!result.enough) {
    assert.ok(result.message, "message provided when not enough");
    assert.ok(result.message.includes("GB") || result.message.includes("space"), "plain message");
  }
});
