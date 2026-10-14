import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, readdir, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const updater = await import(pathToFileURL(join(dist, "component-update.js")));
const desktopUpdate = await import(pathToFileURL(join(dist, "desktop-update.js")));
const { runHelper, move } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
const { parseComponentRelease } = await import(pathToFileURL(join(dist, "component-update-manifest.js")));
const ELECTRON = "44.5.1";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, ms = 20_000) {
  for (const end = Date.now() + ms; !await predicate(); await pause(50)) if (Date.now() > end) throw new Error("Fixture deadline");
}
const exists = file => readFile(file).then(() => true, () => false);

/** A release with engine, window and desktop components served over real loopback HTTP; an installed app beside it. */
async function fixture(run, { runtime = false, iconRuntime = false, macBundle = false } = {}) {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "desktop-update-"));
  const engine = join(root, "engine"), window = join(root, "window"), asar = join(root, "new-asar"), app = join(root, "new-app");
  const dataDir = join(root, "data"), installed = join(root, "installed");
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "old-engine") };
  for (const dir of [join(engine, "dist"), window, asar, join(app, "resources"), cfg.windowDir, join(installed, "resources")]) await mkdir(dir, { recursive: true });
  await writeFile(join(engine, "branch.mjs"), "export {};\n"); await writeFile(join(engine, "dist/entry.js"), "export {};\n");
  await writeFile(join(engine, "dist/build-info.json"), '{"version":"new"}'); await writeFile(join(window, "index.html"), "new window");
  await writeFile(join(asar, "app.asar"), "new desktop asar");
  await writeFile(join(app, "Branch Agent.exe"), "new runtime"); await writeFile(join(app, "resources/app.asar"), "new desktop asar");
  await writeFile(join(cfg.windowDir, "index.html"), "old window"); await writeFile(join(dataDir, "engine-current.txt"), cfg.engineDir + "\n");
  await writeFile(join(installed, "Branch Agent.exe"), "old runtime"); await writeFile(join(installed, "resources/app.asar"), "old desktop asar");
  if (macBundle || process.platform === "darwin" && (runtime || iconRuntime)) {
    for (const bundle of [join(app, "Branch Agent.app"), join(installed, "Branch Agent.app")]) {
      await mkdir(join(bundle, "Contents/MacOS"), { recursive: true });
      await mkdir(join(bundle, "Contents/Resources"), { recursive: true });
    }
    await writeFile(join(app, "Branch Agent.app/Contents/MacOS/Branch Agent"), "new runtime");
    await writeFile(join(app, "Branch Agent.app/Contents/Resources/app.asar"), "new desktop asar");
    await writeFile(join(installed, "Branch Agent.app/Contents/MacOS/Branch Agent"), "old runtime");
    await writeFile(join(installed, "Branch Agent.app/Contents/Resources/app.asar"), "old desktop asar");
  }
  const desktop = { app: asar, electronVersion: runtime ? "45.0.0" : ELECTRON, ...(runtime || iconRuntime || macBundle ? { runtime: app } : {}) };
  const release = await makeComponentRelease({ version: "0.4.5", tag: "v0.4.5", engine, window, desktop, output: join(root, "release") });
  const server = createServer((request, response) => {
    const name = request.url.slice(1);
    if (name === `branch-release-${process.platform}-${process.arch}.json`) return void response.end(JSON.stringify(release));
    createReadStream(join(root, "release", name)).on("error", () => response.writeHead(404).end()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const request = async (url, options) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${new URL(url).pathname.split("/").at(-1)}`, options);
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  const installedApp = macBundle ? join(installed, "Branch Agent.app") : installed;
  const install = { appDir: installedApp, resourcesDir: join(installedApp, macBundle ? "Contents/Resources" : "resources"),
    executable: join(installedApp, macBundle ? "Contents/MacOS/Branch Agent" : "Branch Agent.exe"),
    electronVersion: ELECTRON, nodePath: process.execPath };
  try { await run({ root, cfg, release, request, install }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

test("an AppImage install never stages a swap of its read-only mount", () => {
  assert.equal(desktopUpdate.runsFromAppImage("linux", { APPIMAGE: "/home/person/.local/bin/branch-agent" }), true);
  assert.equal(desktopUpdate.runsFromAppImage("linux", {}), false);
  assert.equal(desktopUpdate.runsFromAppImage("darwin", { APPIMAGE: "/tmp/x" }), false);
});

test("manifest accepts a targeted desktop component and rejects one without its Electron", () => fixture(async ({ release }) => {
  assert.equal(parseComponentRelease(release).components.desktop.electronVersion, ELECTRON);
  const broken = structuredClone(release); delete broken.components.desktop.electronVersion;
  assert.throws(() => parseComponentRelease(broken), /Electron version/);
  const old = structuredClone(release); delete old.components.desktop;
  assert.equal(parseComponentRelease(old).components.desktop, undefined);
}));

test("Keeper icon upgrade follows the first asar update with a same-release whole runtime", { skip: process.platform !== "win32" }, () => fixture(async ({ cfg, request, install, release }) => {
  await writeFile(join(cfg.dataDir, "desktop-update-version.txt"), `${release.version}\n`);
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.kind, "runtime");
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ ...journal, phase: "applied" }));
  assert.equal(await desktopUpdate.confirmDesktopUpdate(cfg), release.version);
  assert.equal((await readFile(join(cfg.dataDir, "desktop-icon-version.txt"), "utf8")).trim(), "keeper-v1");
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), false);
}, { iconRuntime: true }));

test("fresh Keeper package seeds its icon revision without downloading a runtime", { skip: process.platform !== "win32" }, () => fixture(async ({ cfg, install, release }) => {
  await writeFile(join(install.resourcesDir, "keeper-icon-revision"), "keeper-v1\n");
  await writeFile(join(install.resourcesDir, "app.asar"), "new desktop asar");
  let requests = 0;
  const request = () => { requests++; throw new Error("Fresh package must not download a component"); };
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), false);
  assert.equal(requests, 0);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
  assert.equal((await readFile(join(cfg.dataDir, "desktop-icon-version.txt"), "utf8")).trim(), "keeper-v1");
  assert.equal((await readFile(join(cfg.dataDir, "desktop-update-version.txt"), "utf8")).trim(), release.version);
}, { iconRuntime: true }));

test("desktop app.asar stages with the engine and window while the running app stays untouched", () => fixture(async ({ cfg, request, install, release }) => {
  assert.equal(await updater.refreshComponentUpdate(cfg, request, { desktop: install }), true);
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.deepEqual({ kind: journal.kind, phase: journal.phase, sha256: journal.sha256 }, { kind: "asar", phase: "staged", sha256: release.components.desktop.sha256 });
  assert.equal(await readFile(journal.staged, "utf8"), "new desktop asar");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar");
  assert.equal(await updater.refreshComponentUpdate(cfg, request, { desktop: install }), false, "an unfinished publication stages nothing more");
}));

test("macOS stages the sealed whole app even when Electron is unchanged", { skip: process.platform !== "darwin" }, () => fixture(async ({ cfg, request, install, release }) => {
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.kind, "runtime");
  assert.equal(journal.target, install.appDir);
  assert.equal(await readFile(join(journal.staged, "Contents/Resources/app.asar.staged"), "utf8"), "new desktop asar");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar");
}, { macBundle: true }));

test("a held update stages no desktop component", () => fixture(async ({ cfg, request, install }) => {
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ version: "hold", phase: "held" }));
  assert.equal(await updater.refreshComponentUpdate(cfg, request, { desktop: install }), false);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
}));

test("a desktop already on the release stages nothing; a new Electron stages the whole app", async () => {
  await fixture(async ({ cfg, request, install, release }) => {
    await writeFile(join(cfg.dataDir, "desktop-update-version.txt"), "0.4.5\n");
    assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, parseComponentRelease(release), request, install), false);
  });
  await fixture(async ({ cfg, request, install }) => {
    await updater.refreshComponentUpdate(cfg, request, { desktop: install });
    const journal = await desktopUpdate.readDesktopJournal(cfg);
    assert.equal(journal.kind, "runtime");
    assert.equal(journal.target, install.appDir);
    assert.equal(await readFile(join(journal.staged, "resources/app.asar.staged"), "utf8"), "new desktop asar");
  }, { runtime: true });
});

test("an installed desktop with the release's app.asar bytes is neither staged nor swapped", () => fixture(async ({ cfg, request, install, release }) => {
  const sha = createHash("sha256").update("new desktop asar").digest("hex");
  assert.equal(release.components.desktop.appAsarSha256, sha);
  await writeFile(join(install.resourcesDir, "app.asar"), "new desktop asar");
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined, "no download, no journal");
  assert.equal((await readFile(join(cfg.dataDir, "desktop-update-version.txt"), "utf8")).trim(), "0.4.5");
  assert.equal(await exists(join(install.resourcesDir, "app.asar.previous")), false);
}));

test("a staged app.asar identical to the installed one is recorded without a swap or restart", () => fixture(async ({ root, cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  await writeFile(join(install.resourcesDir, "app.asar"), "new desktop asar");
  assert.equal(await desktopUpdate.handOffDesktopUpdate(cfg, install, join(dist, "desktop-update-helper.js"), [join(root, "never.cjs")]), false);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
  assert.equal((await readFile(join(cfg.dataDir, "desktop-update-version.txt"), "utf8")).trim(), "0.4.5");
  assert.equal(await exists(journal.staged), false, "the staged copy is cleaned up");
  assert.equal(await exists(join(install.resourcesDir, "app.asar.previous")), false);
}));

test("a staged whole app identical to the installed one (desktopRuntime) is recorded without a swap", () => fixture(async ({ cfg, request, install, release }) => {
  assert.equal(release.components.desktopRuntime.appAsarSha256, createHash("sha256").update("new desktop asar").digest("hex"));
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  assert.equal((await desktopUpdate.readDesktopJournal(cfg)).kind, "runtime");
  await writeFile(install.executable, "new runtime"); await writeFile(join(install.resourcesDir, "app.asar"), "new desktop asar");
  assert.equal(await desktopUpdate.handOffDesktopUpdate(cfg, install, join(dist, "desktop-update-helper.js")), false);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
  assert.equal((await readFile(join(cfg.dataDir, "desktop-update-version.txt"), "utf8")).trim(), "0.4.5");
  assert.equal(await exists(`${install.appDir}.previous`), false);
}, { runtime: true }));

test("a new Electron without a whole-app package is refused out loud", () => fixture(async ({ cfg, release, request, install }) => {
  const moved = structuredClone(release); moved.components.desktop.electronVersion = "45.0.0";
  await assert.rejects(desktopUpdate.stageDesktopUpdate(cfg, parseComponentRelease(moved), request, install), /install the new desktop package/);
  assert.equal(await desktopUpdate.readDesktopJournal(cfg), undefined);
}));

test("after the app exits the helper swaps app.asar, relaunches, and keeps the app that confirms", () => fixture(async ({ root, cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  // The relaunched "app" is a script that confirms the way main.ts does once its window shows.
  const relaunched = join(root, "relaunched.cjs");
  await writeFile(relaunched, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify(cfg)});`);
  install.executable = process.execPath;
  // The running app hands off and exits; the helper must wait for that exact PID.
  const handOff = `const d=require(${JSON.stringify(join(dist, "desktop-update.js"))});d.handOffDesktopUpdate(${JSON.stringify(cfg)},${JSON.stringify(install)},${JSON.stringify(join(dist, "desktop-update-helper.js"))},[${JSON.stringify(relaunched)}]).then(r=>{if(!r)process.exit(3)})`;
  const app = spawn(process.execPath, ["-e", handOff], { stdio: "inherit" });
  assert.equal(await new Promise(resolve => app.on("exit", resolve)), 0);
  await eventually(async () => (await readFile(join(cfg.dataDir, "desktop-update-version.txt"), "utf8").catch(() => "")).trim() === "0.4.5");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "new desktop asar");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar.previous"), "utf8"), "old desktop asar");
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false);
  await eventually(async () => (await readFile(join(cfg.dataDir, "desktop.log"), "utf8").catch(() => "")).includes("confirmed by the new app"));
}));

test("a new app that never confirms is stopped, the previous app.asar returns and the release is not retried", () => fixture(async ({ cfg, request, install, release }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 4000)"] }, confirmTimeoutMs: 1500 };
  assert.equal(await runHelper(plan), "rolled-back");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar");
  assert.equal(await exists(plan.journal), false);
  assert.equal(await exists(plan.versionFile), false);
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, parseComponentRelease(release), request, install), false, "the rejected desktop release is not staged again");
}));

test("a new Electron swaps the whole app folder and keeps the previous folder beside it", () => fixture(async ({ root, cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  const confirm = join(root, "confirm.cjs");
  await writeFile(confirm, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify(cfg)});`);
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: [confirm] }, confirmTimeoutMs: 15_000 };
  assert.equal(await runHelper(plan), "applied");
  assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "new runtime");
  assert.equal(await readFile(join(install.appDir, "resources/app.asar"), "utf8"), "new desktop asar");
  assert.equal(await readFile(join(`${install.appDir}.previous`, "Branch Agent.exe"), "utf8"), "old runtime");
  assert.equal((await readFile(plan.versionFile, "utf8")).trim(), "0.4.5");
}, { runtime: true }));

test("a swap that cannot move the running copy stays staged without a relaunch loop until Restart", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  await rm(join(install.resourcesDir, "app.asar")); // stands in for a copy that cannot be moved aside
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: ["-e", ""] }, confirmTimeoutMs: 1000 };
  assert.equal(await runHelper(plan), "kept");
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.phase, "staged"); assert.ok(journal.heldUntil > Date.now());
  const helper = join(dist, "desktop-update-helper.js");
  assert.equal(await desktopUpdate.handOffDesktopUpdate(cfg, install, helper, [], false), false, "a normal start does not hand off again");
}));

test("desktop confirmation retains exactly the current and previous update folders", () => fixture(async ({ cfg }) => {
  const retained = [];
  for (const version of ["0.4.1", "0.4.2", "0.4.3"]) {
    const folder = join(cfg.dataDir, "updates", `desktop-${version}-abc123`);
    await mkdir(join(folder, "payload"), { recursive: true });
    const journal = { version, kind: "asar", phase: "staged", staged: join(folder, "payload", "app.asar.staged"), target: join(cfg.dataDir, "app.asar") };
    await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify(journal));
    assert.equal(await desktopUpdate.confirmDesktopUpdate(cfg), null, "staging is not confirmation");
    await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ ...journal, phase: "applied" }));
    assert.equal(await desktopUpdate.confirmDesktopUpdate(cfg), version);
    retained.unshift(folder);
    assert.deepEqual(JSON.parse(await readFile(join(cfg.dataDir, "desktop-update-retained.json"), "utf8")), retained.slice(0, 2));
    assert.equal(await desktopUpdate.confirmDesktopUpdate(cfg), null, "confirmation is idempotent");
  }
}));

/** Runs the launch hand-off in its own process, as the app does at start; exit 0 means the app goes on starting. */
function launchHandOff(cfg, install, helper = join(dist, "desktop-update-helper.js")) {
  const script = `require(${JSON.stringify(join(dist, "desktop-update.js"))}).handOffDesktopUpdate(${JSON.stringify(cfg)},${JSON.stringify(install)},${JSON.stringify(helper)},[],false).then(handed=>process.exit(handed?4:0),error=>{console.error(String(error));process.exit(5);});`;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  return new Promise(resolve => child.on("exit", code => resolve({ code, stderr })));
}

test("a staged record whose payload folder is gone is discarded and the current app starts", () => fixture(async ({ cfg, install }) => {
  const journal = join(cfg.dataDir, "desktop-update-pending.json");
  const staged = join(cfg.dataDir, "updates", "desktop-0.4.5-gone00", "payload", `app${desktopUpdate.STAGED_ASAR}`);
  await writeFile(journal, JSON.stringify({ version: "0.4.5", sha256: "a".repeat(64), kind: "asar", phase: "staged", staged, target: join(install.resourcesDir, "app.asar") }));
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(journal), false, "the stale record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: app\.asar\.staged is missing; starting the current build/);
  assert.equal(await desktopUpdate.stagedDesktopVersion(cfg), null);
}));

test("a staged app.asar whose bytes changed since staging is discarded, never swapped in", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.phase, "staged");
  assert.match(journal.stagedSha256, /^[0-9a-f]{64}$/, "staging records the SHA256 of the payload");
  await writeFile(journal.staged, "tampered desktop asar");
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false, "the altered record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: app\.asar\.staged fails its SHA256/);
}));

test("a missing update helper discards the staged record instead of stopping launch", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const launch = await launchHandOff(cfg, install, join(cfg.dataDir, "no-such-helper.js"));
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false, "the record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: the update helper is missing/);
}));

test("a helper that cannot start discards the staged record and the app keeps starting", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const launch = await launchHandOff(cfg, { ...install, nodePath: join(cfg.dataDir, "no-such-node") });
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false, "the record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: the update helper could not start: /);
}));

test("a helper that is not executable discards the staged record and the app keeps starting", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const node = join(cfg.dataDir, "not-executable-node");
  await writeFile(node, "not a program\n", { mode: 0o644 });
  const launch = await launchHandOff(cfg, { ...install, nodePath: node });
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false, "the record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: the update helper could not start: /);
}));

test("the discard line goes through the same 20 MB cap as desktop.log", () => fixture(async ({ cfg, install }) => {
  const log = join(cfg.dataDir, "desktop.log");
  await writeFile(log, "");
  await truncate(log, 20 * 1024 * 1024 + 1);
  const journal = join(cfg.dataDir, "desktop-update-pending.json");
  await writeFile(journal, JSON.stringify({ version: "0.4.5", sha256: "a".repeat(64), kind: "asar", phase: "staged",
    staged: join(cfg.dataDir, "updates", "desktop-0.4.5-gone00", "payload", `app${desktopUpdate.STAGED_ASAR}`), target: join(install.resourcesDir, "app.asar") }));
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(journal), false, "the record is removed");
  assert.equal(await exists(join(cfg.dataDir, "desktop.1.log")), true, "the full log was rotated to an archive");
  assert.match(await readFile(log, "utf8"), /desktop update 0\.4\.5 discarded: app\.asar\.staged is missing/);
  assert.ok((await stat(log)).size < 1024 * 1024, "the live log is small again");
}));

test("a staged app on another volume than the installed one (EXDEV) is copied into place, links and modes kept", { skip: process.platform === "win32" }, async () => {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "desktop-update-exdev-"));
  try {
    const staged = join(root, "updates", "payload", "Branch Agent.app"), target = join(root, "Applications", "Branch Agent.app");
    const versions = join(staged, "Contents", "Frameworks", "Electron Framework.framework", "Versions");
    await mkdir(join(versions, "A"), { recursive: true }); await mkdir(join(staged, "Contents", "MacOS"), { recursive: true });
    await mkdir(join(root, "Applications"), { recursive: true });
    await writeFile(join(versions, "A", "Electron Framework"), "framework");
    await symlink("A", join(versions, "Current"));
    await writeFile(join(staged, "Contents", "MacOS", "Branch Agent"), "new runtime"); await chmod(join(staged, "Contents", "MacOS", "Branch Agent"), 0o755);
    // The first rename meets another volume, as a payload under the data folder on an external disk does.
    const crossVolume = async (from, to) => {
      if (from === staged) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`), { code: "EXDEV" });
      await rename(from, to);
    };
    await move(staged, target, 120, crossVolume);
    assert.equal(await readFile(join(target, "Contents", "MacOS", "Branch Agent"), "utf8"), "new runtime");
    assert.equal((await stat(join(target, "Contents", "MacOS", "Branch Agent"))).mode & 0o777, 0o755);
    const link = join(target, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "Current");
    assert.ok((await lstat(link)).isSymbolicLink());
    assert.equal(await readlink(link), "A");
    assert.equal(await exists(staged), false, "the staged copy is removed once the new copy is in place");
    assert.deepEqual(await readdir(join(root, "Applications")), ["Branch Agent.app"], "no half-copied folder is left beside the app");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a cross-volume copy that fails leaves the target untouched and the staged copy in place", { skip: process.platform === "win32" }, async () => {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "desktop-update-exdev-"));
  try {
    const staged = join(root, "staged.asar"), target = join(root, "target", "app.asar");
    await writeFile(staged, "new asar"); await mkdir(join(root, "target"));
    // The target's folder is read-only, so the copy beside it fails.
    await chmod(join(root, "target"), 0o555);
    const crossVolume = async () => { throw Object.assign(new Error("EXDEV"), { code: "EXDEV" }); };
    await assert.rejects(move(staged, target, 120, crossVolume));
    await chmod(join(root, "target"), 0o755);
    assert.equal(await readFile(staged, "utf8"), "new asar");
    assert.deepEqual(await readdir(join(root, "target")), []);
  } finally { await chmod(join(root, "target"), 0o755).catch(() => undefined); await rm(root, { recursive: true, force: true }); }
});
