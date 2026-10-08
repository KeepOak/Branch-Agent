import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import fs, { existsSync } from "node:fs";
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

function failCopy(t, pathname) {
  const copy = fs.copyFileSync;
  return t.mock.method(fs, "copyFileSync", (from, to, flags) => {
    if (to === pathname) throw Object.assign(new Error("injected failure"), { code: "EACCES", path: to });
    return copy(from, to, flags);
  });
}

async function replacementFiles(home) {
  const root = join(home, ".branch", ".migration-replaced");
  if (!existsSync(root)) return [];
  const files = [];
  for (const stamp of await readdir(root)) {
    for (const name of await readdir(join(root, stamp, "workspace"))) files.push(join(root, stamp, "workspace", name));
  }
  return files.sort();
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
  await writeFile(join(root, "branch.mjs"), 'import {writeFileSync,readFileSync,statSync,existsSync} from "node:fs"; import {spawnSync} from "node:child_process"; const file=process.env.BRANCH_CUA_DRIVER_ENDPOINT_FILE; delete process.env.BRANCH_CUA_DRIVER_ENDPOINT; delete process.env.BRANCH_CUA_DRIVER_ENDPOINT_FILE; const helper=spawnSync(process.execPath,["-e","const file=process.env.BRANCH_CUA_DRIVER_ENDPOINT_FILE; process.stdout.write(JSON.stringify({endpoint:process.env.BRANCH_CUA_DRIVER_ENDPOINT||String(),file:file||String(),fileExists:file?require(\\"fs\\").existsSync(file):false}))"],{encoding:"utf8",windowsHide:true}); writeFileSync("launch.json",JSON.stringify({endpoint:process.env.BRANCH_CUA_DRIVER_ENDPOINT,file,secret:readFileSync(file,"utf8"),mode:statSync(file).mode & 0o777,helper:JSON.parse(helper.stdout)}));');
  const endpoint = JSON.stringify({ v: 2, port: 21831, secret: "a".repeat(64) });
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token", false, 19631, endpoint);
  await once(child, "close");
  const launch = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
  assert.equal(launch.endpoint, undefined);
  assert.equal(launch.helper.endpoint, "");
  assert.equal(launch.helper.file, "");
  assert.equal(launch.helper.fileExists, false);
  assert.equal(launch.secret, endpoint);
  if (process.platform !== "win32") assert.equal(launch.mode, 0o600);
  assert.equal(existsSync(launch.file), false);
}));

test("a retained older engine has Mac control unavailable without the legacy environment secret", async () => homeFixture(async root => {
  await writeFile(join(root, "branch.mjs"), 'import {writeFileSync} from "node:fs"; writeFileSync("launch.json",JSON.stringify({endpoint:process.env.BRANCH_CUA_DRIVER_ENDPOINT??null,available:Boolean(process.env.BRANCH_CUA_DRIVER_ENDPOINT)}));');
  const endpoint = JSON.stringify({ v: 2, port: 21831, secret: "a".repeat(64) });
  const child = startGateway({ dataDir: root, nodePath: process.execPath, gatewayPort: 19631 }, root, "fixture-token", false, 19631, endpoint);
  await once(child, "exit");
  const launch = JSON.parse(await readFile(join(root, "launch.json"), "utf8"));
  assert.equal(launch.endpoint, null);
  assert.equal(launch.available, false);
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

test("a failed merge backs up only untouched new templates, preserving owner edits and pre-existing files", async (t) => homeFixture(async (root, home) => {
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
  const failedPath = join(home, ".branch", "workspace", "IDENTITY.md");
  const failure = failCopy(t, failedPath);
  const result = prepareNormalProfile(home, undefined, (message) => logs.push(message));
  failure.mock.restore();
  assert.equal(result.legacyDevMode, false);
  assert.match(result.note, /1 profile migration file\(s\) failed/);
  assert.ok(logs.some((message) => message.includes(`code=EACCES path=${failedPath} message=injected failure`)));
  assert.ok(logs.some((message) => /Profile migration done: 2 copied, 0 links skipped, 1 failed/.test(message)));
  assert.deepEqual(await readFile(join(home, ".branch", "branch.json")), beforeConfig);
  assert.equal(existsSync(failedPath), false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "ZZZ.md"), "utf8"), "later sibling");
  assert.equal((await readdir(home)).includes(".branch-dev"), false);
  const archive = (await readdir(home)).find((name) => name.startsWith(".branch-dev.migrated-"));
  assert.equal(await readFile(join(home, archive, "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.equal((await readdir(join(home, ".branch"))).includes(".normal-profile-migrated.json"), false);
  const templates = join(root, "templates");
  await mkdir(templates);
  await writeFile(join(templates, "IDENTITY.md"), "---\ntitle: template\n---\n\nengine template identity");
  await writeFile(join(home, ".branch", "workspace", "AGENTS.md"), "owner edited after failure");
  await writeFile(join(home, ".branch", "workspace", "IDENTITY.md"), "engine template identity");
  assert.equal(prepareNormalProfile(home, undefined, (message) => logs.push(message), templates).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "AGENTS.md"), "utf8"), "owner edited after failure");
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "original\u0000bytes");
  assert.equal(await readFile(join(home, ".branch", "workspace", "USER.md"), "utf8"), "pre-migration owner file");
  assert.equal(await readFile(join(home, ".branch", "workspace", "ZZZ.md"), "utf8"), "later sibling");
  const backups = await replacementFiles(home);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /\.migration-replaced[\\/]\d{4}-[^\\/]+[\\/]workspace[\\/]IDENTITY\.md$/);
  assert.equal(await readFile(backups[0], "utf8"), "engine template identity");
  assert.deepEqual((await readdir(join(home, ".branch", "workspace"))).sort(), ["AGENTS.md", "IDENTITY.md", "USER.md", "ZZZ.md"]);
  assert.match(logs.at(-1), /^Profile migration done: 1 copied, 0 links skipped, 0 failed, \d+ ms$/);
  assert.equal(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migrated.json"), "utf8")).archive, join(home, archive));
  assert.equal(existsSync(join(home, ".branch", ".normal-profile-migration-pending.json")), false);
}));

test("a fresh profile remains launchable when merge pauses after archiving", async (t) => homeFixture(async (_root, home) => {
  await mkdir(join(home, ".branch-dev", "workspace"), { recursive: true });
  await writeFile(join(home, ".branch-dev", "workspace", "IDENTITY.md"), "legacy");
  const failure = failCopy(t, join(home, ".branch", "workspace", "IDENTITY.md"));
  const result = prepareNormalProfile(home);
  failure.mock.restore();
  assert.equal(result.legacyDevMode, false);
  assert.match(result.note, /will resume on next launch/);
  const config = JSON.parse(await readFile(join(home, ".branch", "branch.json"), "utf8"));
  assert.equal(config.agents.defaults.workspace, join(home, ".branch", "workspace"));
  assert.equal(prepareNormalProfile(home).legacyDevMode, false);
  assert.equal(await readFile(join(home, ".branch", "workspace", "IDENTITY.md"), "utf8"), "legacy");
}));

for (const [label, progress] of [["missing", undefined], ["empty", ""], ["garbage", "not JSON"], ["object", "{}"]]) {
  test(`${label} progress resumes missing-only and writes the marker`, async () => homeFixture(async (root, home) => {
    const archive = join(home, ".branch-dev.migrated-fixture", "workspace");
    const normal = join(home, ".branch", "workspace");
    const templates = join(root, "templates");
    await mkdir(archive, { recursive: true });
    await mkdir(normal, { recursive: true });
    await mkdir(templates);
    await writeFile(join(archive, "IDENTITY.md"), "archived identity");
    await writeFile(join(archive, "AGENTS.md"), "archived instructions");
    await writeFile(join(archive, "Notes.md"), "missing notes");
    await writeFile(join(normal, "IDENTITY.md"), "engine identity");
    await writeFile(join(normal, "AGENTS.md"), "owner instructions");
    await writeFile(join(templates, "IDENTITY.md"), "engine identity");
    const pending = join(home, ".branch", ".normal-profile-migration-pending.json");
    if (progress !== undefined) await writeFile(pending, progress);
    assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
    assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "engine identity", "no eligibility evidence means no template replacement");
    assert.equal(await readFile(join(normal, "AGENTS.md"), "utf8"), "owner instructions");
    assert.equal(await readFile(join(normal, "Notes.md"), "utf8"), "missing notes");
    assert.deepEqual(await replacementFiles(home), []);
    assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
    assert.equal(existsSync(pending), false);
  }));
}

test("replaced templates land under migration-replaced outside the live workspace", async () => homeFixture(async (root, home) => {
  const archive = join(home, ".branch-dev.migrated-fixture", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(archive, { recursive: true });
  await mkdir(normal, { recursive: true });
  await mkdir(templates);
  await writeFile(join(archive, "SOUL.md"), "archived soul");
  await writeFile(join(normal, "SOUL.md"), "engine soul");
  await writeFile(join(templates, "SOUL.md"), "engine soul");
  await writeFile(join(home, ".branch", ".normal-profile-migration-pending.json"), '["SOUL.md"]');
  assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
  assert.equal(await readFile(join(normal, "SOUL.md"), "utf8"), "archived soul");
  const backups = await replacementFiles(home);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /\.migration-replaced[\\/]\d{4}-[^\\/]+[\\/]workspace[\\/]SOUL\.md$/);
  assert.equal(await readFile(backups[0], "utf8"), "engine soul");
  assert.deepEqual(await readdir(normal), ["SOUL.md"]);
  assert.equal(await readFile(join(archive, "SOUL.md"), "utf8"), "archived soul");
  assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
}));

test("progress accepts only bootstrap names from an array", async (t) => homeFixture(async (root, home) => {
  const archive = join(home, ".branch-dev.migrated-fixture", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(archive, { recursive: true });
  await mkdir(normal, { recursive: true });
  await mkdir(templates);
  await writeFile(join(archive, "BLOCK.md"), "blocked");
  await writeFile(join(archive, "IDENTITY.md"), "archived identity");
  await writeFile(join(normal, "IDENTITY.md"), "owner edit");
  await writeFile(join(templates, "IDENTITY.md"), "engine identity");
  const pending = join(home, ".branch", ".normal-profile-migration-pending.json");
  await writeFile(pending, JSON.stringify(["AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md", "Notes.md", "../outside", 42, null, {}]));
  const failure = failCopy(t, join(normal, "BLOCK.md"));
  assert.match(prepareNormalProfile(home, undefined, undefined, templates).note, /will resume/);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "owner edit");
  // A successful eligible copy persists the filtered record.
  const archivedRoot = join(home, ".branch-dev.migrated-fixture");
  await writeFile(join(archivedRoot, "workspace", "AGENTS.md"), "archived instructions");
  assert.match(prepareNormalProfile(home, undefined, undefined, templates).note, /will resume/);
  assert.deepEqual(JSON.parse(await readFile(pending, "utf8")).sort(), ["IDENTITY.md", "SOUL.md", "USER.md"]);
  failure.mock.restore();
  assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
  assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
}));

test("an owner edit after launch one survives launch two and launch three while another file fails", async (t) => homeFixture(async (root, home) => {
  const legacy = join(home, ".branch-dev", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(legacy, { recursive: true });
  await mkdir(templates);
  await writeFile(join(legacy, "AGENTS.md"), "archived instructions");
  await writeFile(join(legacy, "BLOCK.md"), "failing sibling");
  await writeFile(join(templates, "AGENTS.md"), "engine instructions");
  const failure = failCopy(t, join(normal, "BLOCK.md"));
  assert.match(prepareNormalProfile(home).note, /will resume/);
  assert.equal(await readFile(join(normal, "AGENTS.md"), "utf8"), "archived instructions");
  await writeFile(join(normal, "AGENTS.md"), "owner edit after launch one");
  for (const launch of [2, 3]) {
    assert.match(prepareNormalProfile(home, undefined, undefined, templates).note, /will resume/);
    assert.equal(await readFile(join(normal, "AGENTS.md"), "utf8"), "owner edit after launch one", `launch ${launch}`);
    assert.equal(existsSync(join(home, ".branch", ".normal-profile-migrated.json")), false);
    assert.deepEqual(await replacementFiles(home), []);
  }
  failure.mock.restore();
  assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
  assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
}));

test("case-insensitive name clashes preserve owner files and do not block the marker", async (t) => homeFixture(async (root, home) => {
  const legacy = join(home, ".branch-dev", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(legacy, { recursive: true });
  await mkdir(normal, { recursive: true });
  await mkdir(templates);
  await writeFile(join(normal, "notes.md"), "owner notes");
  if (!existsSync(join(normal, "Notes.md"))) return t.skip("case-sensitive filesystem");
  await writeFile(join(normal, "identity.md"), "engine identity");
  await writeFile(join(templates, "IDENTITY.md"), "engine identity");
  await writeFile(join(legacy, "Notes.md"), "archived notes");
  await writeFile(join(legacy, "IDENTITY.md"), "archived identity");
  await writeFile(join(legacy, "BLOCK.md"), "blocked");
  const failure = failCopy(t, join(normal, "BLOCK.md"));
  assert.match(prepareNormalProfile(home).note, /will resume/);
  assert.deepEqual(JSON.parse(await readFile(join(home, ".branch", ".normal-profile-migration-pending.json"), "utf8")), [], "the case variant existed before migration");
  failure.mock.restore();
  assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
  assert.equal(await readFile(join(normal, "Notes.md"), "utf8"), "owner notes");
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "engine identity");
  assert.deepEqual(await replacementFiles(home), []);
  assert.deepEqual(readPreparedNormalProfile(home), { legacyDevMode: false });
}));

test("a file that keeps failing cannot repeatedly overwrite a restored bootstrap file", async (t) => homeFixture(async (root, home) => {
  const legacy = join(home, ".branch-dev", "workspace");
  const normal = join(home, ".branch", "workspace");
  const templates = join(root, "templates");
  await mkdir(legacy, { recursive: true });
  await mkdir(templates);
  await writeFile(join(legacy, "BLOCK.md"), "failing sibling");
  await writeFile(join(legacy, "IDENTITY.md"), "archived identity");
  await writeFile(join(templates, "IDENTITY.md"), "engine identity");
  const firstFailure = failCopy(t, join(normal, "IDENTITY.md"));
  assert.match(prepareNormalProfile(home).note, /will resume/);
  firstFailure.mock.restore();
  await rm(join(normal, "BLOCK.md"));
  await writeFile(join(normal, "IDENTITY.md"), "engine identity");
  const failure = failCopy(t, join(normal, "BLOCK.md"));
  assert.match(prepareNormalProfile(home, undefined, undefined, templates).note, /will resume/);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "archived identity");
  const backups = await replacementFiles(home);
  assert.equal(backups.length, 1);
  await writeFile(join(normal, "IDENTITY.md"), "owner edit after restore");
  assert.match(prepareNormalProfile(home, undefined, undefined, templates).note, /will resume/);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "owner edit after restore");
  assert.deepEqual(await replacementFiles(home), backups);
  assert.equal(existsSync(join(home, ".branch", ".normal-profile-migrated.json")), false);
  failure.mock.restore();
  assert.equal(prepareNormalProfile(home, undefined, undefined, templates).note, undefined);
  assert.equal(await readFile(join(normal, "IDENTITY.md"), "utf8"), "owner edit after restore");
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
