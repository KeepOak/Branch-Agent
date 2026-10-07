import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to strict-compiled sources");
const { prepareNormalProfile } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "profile-migration.js")));
const { startGateway } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));

async function homeFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "branch-normal-profile-"));
  try { await run(root, join(root, "home")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("fresh desktop install starts without dev profile or C3-PO", async () => homeFixture(async (root, home) => {
  await writeFile(join(root, "branch.mjs"), 'import {writeFileSync} from "node:fs"; writeFileSync("launch.json",JSON.stringify({profile:process.env.BRANCH_PROFILE,args:process.argv.slice(2)}));');
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token");
  await once(child, "exit");
  const launch = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
  const config = JSON.parse(await readFile(join(home, ".branch", "branch.json"), "utf8"));
  assert.equal(launch.profile, "default");
  assert.ok(!launch.args.includes("--dev"));
  assert.equal(config.agents.ownership, "explicit");
  assert.deepEqual(Object.keys(config.agents), ["ownership", "defaults"]);
  assert.ok(!JSON.stringify(config).includes("C3-PO"));
  assert.equal((await readdir(home)).includes(".branch-dev"), false);
  assert.ok((await readdir(join(home, ".branch"))).includes(".normal-profile-migrated.json"));
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "intentional dev profile");
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal((await readdir(home)).some((name) => name.startsWith(".branch-dev.migrated-")), false);
  assert.equal(await readFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "utf8"), "intentional dev profile");
}));

test("owner-shaped dev workspace migrates once with the original archived and normal files preserved", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch", "state"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "state"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "plugin-skills"), { recursive: true });
  await writeFile(join(home, ".branch", "branch.json"), '{"agents":{"entries":{"dev":{"identity":{"name":"C3-PO"}}}}}');
  await writeFile(join(home, ".branch", "state", "owner.txt"), "current");
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "old workspace");
  await writeFile(join(home, ".branch-dev", "state", "legacy.txt"), "legacy state");
  await writeFile(join(home, ".branch-dev", "plugin-skills", "notes.txt"), "skill");
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "old workspace");
  assert.equal(await readFile(join(home, ".branch", "state", "owner.txt"), "utf8"), "current");
  assert.equal(await readFile(join(home, ".branch", "state", "legacy.txt"), "utf8"), "legacy state");
  assert.equal(await readFile(join(home, ".branch", "plugin-skills", "notes.txt"), "utf8"), "skill");
  const names = await readdir(home);
  const archive = names.find((name) => name.startsWith(".branch-dev.migrated-"));
  assert.ok(archive);
  // The original legacy profile is kept whole; no second byte copy is made.
  assert.equal(await readFile(join(home, archive, "workspace", "IDENTITY.md"), "utf8"), "old workspace");
  assert.equal(names.some((name) => name.startsWith(".migration-backup-")), false);
  assert.ok(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migrated.json"), "utf8")));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.deepEqual(await readdir(home), names);
}));

test("a dangling link or junction in the legacy profile never stops the migration or the app", async () => homeFixture(async (root, home) => {
  // As the owner's profile: plugin-skills/browser-automation was a junction into an engine release since removed.
  const gone = join(root, "updates", "release-gone", "engine", "skills", "browser-automation");
  await mkdir(join(home, ".branch"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "plugin-skills"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch", "branch.json"), "{}\n");
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "kept");
  await mkdir(gone, { recursive: true });
  await symlink(gone, join(home, ".branch-dev", "plugin-skills", "browser-automation"), process.platform === "win32" ? "junction" : "dir");
  await rm(join(root, "updates"), { recursive: true });
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "kept");
  assert.equal(existsSync(join(home, ".branch", "plugin-skills", "browser-automation")), false, "a dangling link was copied");
  const archive = (await readdir(home)).find((name) => name.startsWith(".branch-dev.migrated-"));
  assert.ok((await lstat(join(home, archive, "plugin-skills", "browser-automation"))).isSymbolicLink(), "the archive lost the original link");
}));

test("mid-migration failure rolls back original files byte-identically", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch", "branch.json"), "{\"owner\":true}\n");
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "original\u0000bytes");
  const beforeConfig = await readFile(join(home, ".branch", "branch.json"));
  const beforeWorkspace = await readFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"));
  const result = prepareNormalProfile(home, () => { throw new Error("injected failure"); });
  assert.equal(result.legacyDevMode, true);
  assert.deepEqual(await readFile(join(home, ".branch", "branch.json")), beforeConfig);
  assert.deepEqual(await readFile(join(home, ".branch-dev", "workspace", "IDENTITY.md")), beforeWorkspace);
  assert.equal((await readdir(join(home, ".branch"))).includes("workspace"), false);
  assert.equal((await readdir(join(home, ".branch"))).includes(".normal-profile-migrated.json"), false);
  assert.equal((await readdir(home)).some((name) => name.startsWith(".migration-backup-")), false);
}));

test("keeps a normal SQLite database separate from legacy sidecars", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch", "state"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "state"), { recursive: true });
  await writeFile(join(home, ".branch", "state", "store.sqlite"), "normal database");
  await writeFile(join(home, ".branch-dev", "state", "store.sqlite"), "legacy database");
  await writeFile(join(home, ".branch-dev", "state", "store.sqlite-wal"), "legacy WAL");
  await writeFile(join(home, ".branch-dev", "state", "store.sqlite-shm"), "legacy SHM");
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.deepEqual(await readdir(join(home, ".branch", "state")), ["store.sqlite"]);
  assert.equal(await readFile(join(home, ".branch", "state", "store.sqlite"), "utf8"), "normal database");
}));
