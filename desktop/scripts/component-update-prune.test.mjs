import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { checkDiskSpace, pruneOldReleases } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-prune.js")));

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
  const root = await mkdtemp(join(tmpdir(), "branch-prune-"));
  const dataDir = join(root, "data");
  const updates = join(dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "old-engine") };
  try { await run({ root, cfg, updates }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

test("prune keeps current and previous builds after apply", async () => fixture(async ({ cfg, updates }) => {
  const release1 = await makeRelease(updates, "release-0.4.1-aaaaa1");
  const release2 = await makeRelease(updates, "release-0.4.2-bbbbb2");
  const release3 = await makeRelease(updates, "release-0.4.3-ccccc3");
  const release4 = await makeRelease(updates, "release-0.4.4-ddddd4");
  const release5 = await makeRelease(updates, "release-0.4.5-eeeee5");
  await pruneOldReleases(cfg, join(release5, "engine"), join(release4, "engine"), undefined);
  const remaining = await readdir(updates);
  assert.deepEqual(remaining.sort(), ["release-0.4.4-ddddd4", "release-0.4.5-eeeee5"]);
  void release1; void release2; void release3;
}));

test("prune never deletes active or staged build", async () => fixture(async ({ cfg, updates }) => {
  const previous = await makeRelease(updates, "release-0.4.1-aaaaa1");
  const running = await makeRelease(updates, "release-0.4.2-bbbbb2");
  const current = await makeRelease(updates, "release-0.4.3-ccccc3");
  const staged = await makeRelease(updates, "release-0.4.4-ddddd4");
  await writeFile(join(cfg.dataDir, "engine-running.txt"), join(running, "engine") + "\n");
  await pruneOldReleases(cfg, join(current, "engine"), join(previous, "engine"), join(staged, "engine"));
  assert.deepEqual((await readdir(updates)).sort(), [
    "release-0.4.1-aaaaa1", "release-0.4.2-bbbbb2", "release-0.4.3-ccccc3", "release-0.4.4-ddddd4",
  ]);
}));

test("prune skips incomplete downloads without failing", async () => fixture(async ({ cfg, updates }) => {
  await makeRelease(updates, "release-0.4.1-aaaaa1");
  await makeRelease(updates, "release-0.4.2-bbbbb2", false);
  const current = await makeRelease(updates, "release-0.4.3-ccccc3");
  await pruneOldReleases(cfg, join(current, "engine"), "", undefined);
  assert.deepEqual((await readdir(updates)).sort(), ["release-0.4.2-bbbbb2", "release-0.4.3-ccccc3"]);
}));

test("prune cleans trash folders from previous failed deletes", async () => fixture(async ({ cfg, updates }) => {
  const current = await makeRelease(updates, "release-0.4.3-ccccc3");
  await mkdir(join(updates, ".trash-release-0.4.1-aaaaa1-1-a"), { recursive: true });
  await mkdir(join(updates, ".trash-release-0.4.2-bbbbb2-2-b"), { recursive: true });
  await pruneOldReleases(cfg, join(current, "engine"), "", undefined);
  assert.deepEqual(await readdir(updates), ["release-0.4.3-ccccc3"]);
}));

test("launch prune cleans an already-full folder", async () => fixture(async ({ cfg, updates }) => {
  const names = [];
  for (let i = 1; i <= 10; i++) names.push(`release-0.4.${i}-${String(i).padStart(6, "0")}`);
  for (const name of names) await makeRelease(updates, name);
  await pruneOldReleases(cfg, join(updates, names[9], "engine"), join(updates, names[8], "engine"), undefined);
  assert.deepEqual((await readdir(updates)).sort(), [names[8], names[9]].sort());
}));

test("prune only deletes matching release folders inside the updates directory", async () => fixture(async ({ cfg, updates, root }) => {
  const current = await makeRelease(updates, "release-0.4.5-eeeee5");
  await makeRelease(updates, "release-0.4.1-aaaaa1");
  await writeFile(join(updates, "notes.txt"), "keep");
  await mkdir(join(updates, "not-a-release"), { recursive: true });
  await writeFile(join(updates, "not-a-release", "keep.txt"), "keep");
  await mkdir(join(updates, "release-too-short"), { recursive: true });
  const outside = join(root, "outside");
  const decoy = join(outside, "release-0.4.0-ffffff");
  await mkdir(join(decoy, "engine"), { recursive: true });
  await writeFile(join(decoy, ".release-complete"), "");
  await writeFile(join(cfg.dataDir, "keep-me.txt"), "keep");
  await pruneOldReleases(cfg, join(current, "engine"), "", undefined);
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.5-eeeee5"));
  assert.ok(!remaining.includes("release-0.4.1-aaaaa1"));
  assert.ok(remaining.includes("notes.txt"));
  assert.ok(remaining.includes("not-a-release"));
  assert.ok(remaining.includes("release-too-short"));
  assert.equal((await lstat(decoy)).isDirectory(), true, "a matching name outside updates was not deleted");
  assert.equal(await readFile(join(cfg.dataDir, "keep-me.txt"), "utf8"), "keep");
}));

test("prune never follows a symlink or junction out of the updates folder", async () => fixture(async ({ cfg, updates, root }) => {
  const current = await makeRelease(updates, "release-0.4.5-eeeee5");
  await makeRelease(updates, "release-0.4.1-aaaaa1");
  const outside = join(root, "foreign-release");
  await mkdir(join(outside, "engine"), { recursive: true });
  await writeFile(join(outside, "engine", "secret.txt"), "do-not-delete");
  await writeFile(join(outside, ".release-complete"), "");
  const link = join(updates, "release-0.4.0-link01");
  await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  await pruneOldReleases(cfg, join(current, "engine"), "", undefined);
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.0-link01"), "the link itself is left alone");
  assert.ok(!remaining.includes("release-0.4.1-aaaaa1"));
  assert.equal(await readFile(join(outside, "engine", "secret.txt"), "utf8"), "do-not-delete");
  assert.equal((await lstat(link)).isSymbolicLink() || process.platform === "win32", true);
}));

test("prune does nothing when the active build is unknown", async () => fixture(async ({ cfg, updates }) => {
  await makeRelease(updates, "release-0.4.1-aaaaa1");
  await makeRelease(updates, "release-0.4.2-bbbbb2");
  await makeRelease(updates, "release-0.4.3-ccccc3");
  await pruneOldReleases(cfg, "", "", undefined);
  assert.deepEqual((await readdir(updates)).sort(), [
    "release-0.4.1-aaaaa1", "release-0.4.2-bbbbb2", "release-0.4.3-ccccc3",
  ]);
}));

test("a locked or undeletable release is skipped without failing the prune", async () => fixture(async ({ cfg, updates }) => {
  const current = await makeRelease(updates, "release-0.4.5-eeeee5");
  await makeRelease(updates, "release-0.4.1-aaaaa1");
  const failures = [];
  await chmod(updates, 0o555);
  try {
    await pruneOldReleases(cfg, join(current, "engine"), "", undefined, error => failures.push(error));
  } finally {
    await chmod(updates, 0o755);
  }
  const remaining = await readdir(updates);
  assert.ok(remaining.includes("release-0.4.5-eeeee5"));
  assert.ok(remaining.includes("release-0.4.1-aaaaa1"), "locked stale release was left for a later pass");
  assert.ok(failures.length >= 1, "the locked delete was logged");
}));

test("disk space check returns enough=true when space is available", async () => {
  const result = await checkDiskSpace(tmpdir(), 1024 * 1024);
  assert.equal(result.enough, true);
  assert.equal(result.message, undefined);
});

test("low free space reports the plain-words disk message", async () => {
  const result = await checkDiskSpace(tmpdir(), 50 * 1024 * 1024 * 1024 * 1024);
  assert.equal(result.enough, false);
  assert.match(result.message ?? "", /Not enough disk space to download the update\. Branch needs about \d+\.\d+ GB free\./);
});
