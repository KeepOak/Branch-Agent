import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to strict-compiled sources");
const { copyTreeSkippingLinks, prepareNormalProfile, readPreparedNormalProfile, renameWithRetry } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "profile-migration.js")));
const { startGateway } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));

async function homeFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "branch-normal-profile-"));
  try { await run(root, join(root, "home")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function waitForLog(file, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const log = await readFile(file, "utf8");
    if (log.includes(expected)) return log;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return readFile(file, "utf8");
}

test("standby never creates or migrates an unprepared profile", async () => homeFixture(async (_root, home) => {
  assert.throws(() => readPreparedNormalProfile(home), /not ready/);
  await assert.rejects(readdir(home), { code: "ENOENT" });
  prepareNormalProfile(home);
  assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
}));

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

test("desktop passes only its app-owned Mac driver lease to the live gateway", async () => homeFixture(async root => {
  await writeFile(join(root, "branch.mjs"), 'import {writeFileSync} from "node:fs"; writeFileSync("launch.json",JSON.stringify({endpoint:process.env.BRANCH_CUA_DRIVER_ENDPOINT}));');
  const endpoint = JSON.stringify({ v: 2, port: 21831, secret: "a".repeat(64) });
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token", false, 19631, endpoint);
  await once(child, "exit");
  assert.equal(JSON.parse(await readFile(join(root, "launch.json"), "utf8")).endpoint, endpoint);
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
  // The original legacy profile is kept whole as the archive; the backup skipped nothing here.
  assert.equal(await readFile(join(home, archive, "workspace", "IDENTITY.md"), "utf8"), "old workspace");
  const backup = names.find((name) => name.startsWith(".migration-backup-"));
  assert.ok(backup);
  assert.equal(await readFile(join(home, backup, ".branch-dev", "workspace", "IDENTITY.md"), "utf8"), "old workspace");
  assert.ok(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migrated.json"), "utf8")));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.deepEqual(await readdir(home), names);
}));

test("gateway log records migration start, counts, and failure details", async () => homeFixture(async (root, home) => {
  await writeFile(join(root, "branch.mjs"), "");
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "owner");
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token");
  await once(child, "exit");
  const log = await waitForLog(join(root, "gateway.log"), "Profile migration done:");
  assert.match(log, /starting profile migration/);
  assert.match(log, /Profile migration start/);
  assert.match(log, /Profile migration backup/);
  assert.match(log, /Profile migration copy/);
  assert.match(log, /Profile migration done: 1 copied, 0 links skipped, \d+ ms/);
  assert.match(log, /spawning gateway/);
  await rm(join(home, ".branch"), { recursive: true });
  await writeFile(join(home, ".branch"), "not a directory");
  const failed = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token");
  await once(failed, "exit");
  const failureLog = await waitForLog(join(root, "gateway.log"), "Profile migration failed");
  assert.ok(failureLog.includes(`Profile migration failed (code=UNKNOWN path=${join(home, ".branch")} message=Normal profile root is not a directory)`));
  assert.match(failureLog, /retaining the previous gateway layout/);
  assert.equal((await readdir(home)).includes(".branch-dev"), true);
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
  const logs = [];
  assert.equal(prepareNormalProfile(home, undefined, (message) => logs.push(message)).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "kept");
  assert.equal(existsSync(join(home, ".branch", "plugin-skills", "browser-automation")), false, "a dangling link was copied");
  const archive = (await readdir(home)).find((name) => name.startsWith(".branch-dev.migrated-"));
  assert.ok((await lstat(join(home, archive, "plugin-skills", "browser-automation"))).isSymbolicLink(), "the archive lost the original link");
  const backup = (await readdir(home)).find((name) => name.startsWith(".migration-backup-"));
  assert.ok(backup);
  assert.equal(existsSync(join(home, backup, ".branch-dev", "plugin-skills", "browser-automation")), false, "backup followed a dangling link");
  assert.ok(logs.some((message) => message.includes("Profile migration skipped link") && message.includes("browser-automation")));
}));

test("mid-migration failure falls back to the legacy layout", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch", "branch.json"), "{\"owner\":true}\n");
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "original\u0000bytes");
  const beforeConfig = await readFile(join(home, ".branch", "branch.json"));
  const logs = [];
  const failure = Object.assign(new Error("injected failure"), { code: "EACCES", path: join(home, ".branch", "workspace", "IDENTITY.md") });
  const result = prepareNormalProfile(home, () => { throw failure; }, (message) => logs.push(message));
  assert.equal(result.legacyDevMode, true);
  assert.match(result.note, /retaining the previous gateway layout/);
  assert.match(result.note, /code=EACCES/);
  assert.ok(result.note.includes(`path=${failure.path}`));
  assert.match(result.note, /message=injected failure/);
  assert.ok(logs.includes("Profile migration start"));
  assert.ok(logs.includes("Profile migration backup"));
  assert.ok(logs.includes("Profile migration copy"));
  assert.ok(logs.some((message) => message.startsWith("Profile migration failed")));
  assert.deepEqual(await readFile(join(home, ".branch", "branch.json")), beforeConfig);
  assert.equal(await readFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.equal((await readdir(home)).includes(".branch-dev"), true);
  assert.equal((await readdir(home)).some((name) => name.startsWith(".branch-dev.migrated-")), false);
  assert.equal((await readdir(home)).some((name) => name.startsWith(".migration-backup-")), false);
  assert.equal((await readdir(join(home, ".branch"))).includes(".normal-profile-migrated.json"), false);
  assert.equal(prepareNormalProfile(home, undefined, (message) => logs.push(message)).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.match(logs.at(-1), /^Profile migration done: 1 copied, 0 links skipped, \d+ ms$/);
}));

test("a fresh profile remains launchable when merge pauses", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "legacy");
  const result = prepareNormalProfile(home, () => { throw new Error("paused merge"); });
  assert.equal(result.legacyDevMode, true);
  assert.match(result.note, /retaining the previous gateway layout/);
  assert.equal(await readFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "utf8"), "legacy");
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "legacy");
}));

function dirLinkType() {
  return process.platform === "win32" ? "junction" : "dir";
}

async function assertBackupSkipsLink(root, home, makeLink) {
  const profile = join(home, ".branch-dev");
  await mkdir(join(profile, "workspace"), { recursive: true });
  await writeFile(join(profile, "workspace", "IDENTITY.md"), "kept");
  await makeLink(profile);
  const backup = join(root, "backup");
  const logs = [];
  const counts = copyTreeSkippingLinks(profile, backup, (message) => logs.push(message));
  assert.ok(counts.linksSkipped >= 1);
  assert.equal(await readFile(join(backup, "workspace", "IDENTITY.md"), "utf8"), "kept");
  assert.ok(logs.some((message) => message.startsWith("Profile migration skipped link")));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "kept");
}

test("a broken symlink in the profile backs up without crashing", async () => homeFixture(async (root, home) => {
  await assertBackupSkipsLink(root, home, async (profile) => {
    await symlink(join(root, "gone-target"), join(profile, "broken"));
  });
  assert.equal(existsSync(join(root, "backup", "broken")), false);
}));

test("a junction or directory symlink in the profile backs up without crashing", async () => homeFixture(async (root, home) => {
  const target = join(root, "release-gone", "skills", "browser-automation");
  await mkdir(target, { recursive: true });
  await assertBackupSkipsLink(root, home, async (profile) => {
    await mkdir(join(profile, "plugin-skills"), { recursive: true });
    await symlink(target, join(profile, "plugin-skills", "browser-automation"), dirLinkType());
    await rm(join(root, "release-gone"), { recursive: true });
  });
  assert.equal(existsSync(join(root, "backup", "plugin-skills", "browser-automation")), false);
}));

test("a symlink loop in the profile backs up without crashing", async () => homeFixture(async (root, home) => {
  await assertBackupSkipsLink(root, home, async (profile) => {
    await mkdir(join(profile, "left"), { recursive: true });
    await mkdir(join(profile, "right"), { recursive: true });
    await symlink(join(profile, "right"), join(profile, "left", "to-right"), dirLinkType());
    await symlink(join(profile, "left"), join(profile, "right", "to-left"), dirLinkType());
  });
  assert.equal(existsSync(join(root, "backup", "left", "to-right")), false);
  assert.equal(existsSync(join(root, "backup", "right", "to-left")), false);
}));

test("transient rename locks retry and permanent locks stop after bounded attempts", async () => homeFixture(async (_root, home) => {
  let attempts = 0;
  const locked = Object.assign(new Error("locked"), { code: "EPERM" });
  renameWithRetry("old", "new", () => { if (++attempts < 3) throw locked; });
  assert.equal(attempts, 3);
  attempts = 0;
  assert.throws(() => renameWithRetry("old", "new", () => { attempts++; throw locked; }), /locked/);
  assert.equal(attempts, 4);
  attempts = 0;
  const invalid = Object.assign(new Error("invalid"), { code: "EINVAL" });
  assert.throws(() => renameWithRetry("old", "new", () => { attempts++; throw invalid; }), /invalid/);
  assert.equal(attempts, 1);
}));

test("sockets and FIFOs are ignored while regular profile files migrate", async () => homeFixture(async (root, home) => {
  const workspace = join(home, ".branch-dev", "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "IDENTITY.md"), "kept");
  if (process.platform !== "win32") {
    const fifo = join(workspace, "service.fifo");
    const result = spawnSync("mkfifo", [fifo], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString());
    const socket = createServer();
    // macOS has a short Unix-domain path limit; bind near the temp root, then move the socket entry.
    const bound = join(root, "service.sock");
    socket.listen(bound);
    await once(socket, "listening");
    try {
      await rename(bound, join(workspace, "service.sock"));
      assert.equal(prepareNormalProfile(home).legacyDevMode, false);
    } finally {
      await new Promise((resolve) => socket.close(resolve));
    }
  } else {
    assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  }
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "kept");
  assert.equal((await readdir(join(home, ".branch", "workspace"))).includes("service.fifo"), false);
  assert.equal((await readdir(join(home, ".branch", "workspace"))).includes("service.sock"), false);
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
