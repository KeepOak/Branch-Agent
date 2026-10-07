import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to strict-compiled sources");
const { prepareNormalProfile, readPreparedNormalProfile, renameWithRetry } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "profile-migration.js")));
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
  // The original legacy profile is kept whole; no second byte copy is made.
  assert.equal(await readFile(join(home, archive, "workspace", "IDENTITY.md"), "utf8"), "old workspace");
  assert.equal(names.some((name) => name.startsWith(".migration-backup-")), false);
  assert.ok(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migrated.json"), "utf8")));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.deepEqual(await readdir(home), names);
}));

test("gateway log records migration start, counts, and failure details", async () => homeFixture(async (root, home) => {
  await writeFile(join(root, "branch.mjs"), "");
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "owner");
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token");
  const exited = once(child, "exit");
  assert.match(await readFile(join(root, "gateway.log"), "utf8"), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z Profile migration start\n/,
    "migration start must be on disk before startGateway returns");
  await exited;
  const log = await waitForLog(join(root, "gateway.log"), "Profile migration done:");
  assert.match(log, /Profile migration start/);
  assert.match(log, /Profile migration done: 1 copied, 0 links skipped, 0 failed, \d+ ms/);
  await rm(join(home, ".branch"), { recursive: true });
  await writeFile(join(home, ".branch"), "not a directory");
  const failed = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token");
  await once(failed, "exit");
  const failureLog = await waitForLog(join(root, "gateway.log"), "Profile migration failed");
  assert.ok(failureLog.includes(`Profile migration failed (code=UNKNOWN path=${join(home, ".branch")} message=Normal profile root is not a directory)`));
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

test("a failed merge backs up only untouched new templates, preserving owner edits and pre-existing files", async () => homeFixture(async (root, home) => {
  await mkdir(join(home, ".branch"), { recursive: true });
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch", "branch.json"), "{\"owner\":true}\n");
  await mkdir(join(home, ".branch", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch", "workspace", "USER.md"), "pre-migration owner file");
  await writeFile(join(home, ".branch-dev", "workspace", "AGENTS.md"), "owner instructions");
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "original\u0000bytes");
  await writeFile(join(home, ".branch-dev", "workspace", "USER.md"), "archived user file");
  await writeFile(join(home, ".branch-dev", "workspace", "ZZZ.md"), "later sibling");
  const beforeConfig = await readFile(join(home, ".branch", "branch.json"));
  const logs = [];
  let copied = 0;
  const failure = Object.assign(new Error("injected failure"), { code: "EACCES", path: join(home, ".branch", "workspace", "IDENTITY.md") });
  const result = prepareNormalProfile(home, () => {
    if (++copied === 1) {
      mkdirSync(join(home, ".branch", "workspace", "IDENTITY.md"));
      throw failure;
    }
  }, (message) => logs.push(message));
  assert.equal(result.legacyDevMode, false);
  assert.match(result.note, /2 profile migration file\(s\) failed/);
  assert.ok(logs.some((message) => message.includes(`code=EACCES path=${failure.path} message=injected failure`)));
  assert.ok(logs.some((message) => /Profile migration done: 2 copied, 0 links skipped, 2 failed/.test(message)));
  assert.deepEqual(await readFile(join(home, ".branch", "branch.json")), beforeConfig);
  assert.ok((await lstat(join(home, ".branch", "workspace", "IDENTITY.md"))).isDirectory());
  assert.equal(await readFile(join(home, ".branch", "workspace", "ZZZ.md"), "utf8"), "later sibling");
  assert.equal((await readdir(home)).includes(".branch-dev"), false);
  const archive = (await readdir(home)).find((name) => name.startsWith(".branch-dev.migrated-"));
  assert.equal(await readFile(join(home, archive, "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.equal((await readdir(join(home, ".branch"))).includes(".normal-profile-migrated.json"), false);
  const templates = join(root, "templates");
  await mkdir(templates);
  await writeFile(join(templates, "IDENTITY.md"), "---\ntitle: template\n---\n\nengine template identity");
  await writeFile(join(home, ".branch", "workspace", "AGENTS.md"), "owner edited after failure");
  await rm(join(home, ".branch", "workspace", "IDENTITY.md"), { recursive: true });
  await writeFile(join(home, ".branch", "workspace", "IDENTITY.md"), "engine template identity");
  assert.equal(prepareNormalProfile(home, () => { copied++; }, (message) => logs.push(message), templates).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "AGENTS.md"), "utf8"), "owner edited after failure");
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.equal(await readFile(join(home, ".branch", "workspace", "USER.md"), "utf8"), "pre-migration owner file");
  assert.equal(await readFile(join(home, ".branch", "workspace", "ZZZ.md"), "utf8"), "later sibling");
  const backups = (await readdir(join(home, ".branch", "workspace"))).filter(name => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^IDENTITY\.md\.\d{4}-.*\.bak$/);
  assert.equal(await readFile(join(home, ".branch", "workspace", backups[0]), "utf8"), "engine template identity");
  assert.equal(copied, 3, "only the untouched template was replaced");
  assert.match(logs.at(-1), /^Profile migration done: 1 copied, 0 links skipped, 0 failed, \d+ ms$/);
  assert.equal(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migrated.json"), "utf8")).archive, join(home, archive));
}));

test("a fresh profile remains launchable when merge pauses after archiving", async () => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "legacy");
  const result = prepareNormalProfile(home, () => { throw new Error("paused merge"); });
  assert.equal(result.legacyDevMode, false);
  assert.match(result.note, /will resume on next launch/);
  const config = JSON.parse(await readFile(join(home, ".branch", "branch.json"), "utf8"));
  assert.equal(config.agents.defaults.workspace, join(home, ".branch", "workspace"));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "legacy");
}));

test("a file that keeps failing cannot repeatedly overwrite a restored bootstrap file", async () => homeFixture(async (root, home) => {
  const legacy = join(home, ".branch-dev", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(legacy, { recursive: true });
  await mkdir(templates);
  await writeFile(join(legacy, "AAA.md"), "first sibling");
  await writeFile(join(legacy, "IDENTITY.md"), "archived identity");
  await writeFile(join(templates, "IDENTITY.md"), "engine identity");
  assert.match(prepareNormalProfile(home, () => { mkdirSync(join(normal, "IDENTITY.md")); }).note, /will resume/);
  await rm(join(normal, "IDENTITY.md"), { recursive: true });
  await writeFile(join(normal, "IDENTITY.md"), "engine identity");
  const fail = () => { throw new Error("injected failure"); };
  assert.match(prepareNormalProfile(home, fail, undefined, templates).note, /will resume/);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "archived identity");
  const backups = (await readdir(normal)).filter(name => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  await writeFile(join(normal, "IDENTITY.md"), "owner edit after restore");
  assert.equal(prepareNormalProfile(home, fail, undefined, templates).legacyDevMode, false);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "owner edit after restore");
  assert.deepEqual((await readdir(normal)).filter(name => name.endsWith(".bak")), backups);
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
