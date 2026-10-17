import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import * as launcher from "./windows-launcher.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const updater = await import(pathToFileURL(join(dist, "component-update.js")));
const desktopUpdate = await import(pathToFileURL(join(dist, "desktop-update.js")));
const { runHelper } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
const { parseComponentRelease } = await import(pathToFileURL(join(dist, "component-update-manifest.js")));
const { cwdHoldsAppFolder, leaveAppWorkingFolder, userHome } = await import(pathToFileURL(join(dist, "app-working-folder.js")));
const holders = await import(pathToFileURL(join(dist, "install-folder-holders.js")));
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

test("startup changes the working folder when it starts inside the app folder", () => {
  const appDir = "C:\\Users\\person\\AppData\\Local\\Programs\\Branch Agent\\app-0.4.5-abcdef";
  const installRoot = "C:\\Users\\person\\AppData\\Local\\Programs\\Branch Agent";
  const home = "C:\\Users\\person";
  const portable = "C:\\Users\\person\\BranchApp\\dist\\v0.4.5\\Branch Agent-win32-x64";
  assert.equal(cwdHoldsAppFolder(appDir, appDir, true), true);
  assert.equal(cwdHoldsAppFolder(join(appDir, "resources"), appDir, true), true);
  assert.equal(cwdHoldsAppFolder(installRoot, appDir, true), true, "Setup Start in was the install root");
  assert.equal(cwdHoldsAppFolder(portable, portable, true), true);
  assert.equal(cwdHoldsAppFolder(home, appDir, true), false);
  const seen = [];
  assert.equal(leaveAppWorkingFolder({ cwd: appDir, appDir, home, chdir: (dir) => seen.push(dir), win32: true }), true);
  assert.deepEqual(seen, [home]);
  seen.length = 0;
  assert.equal(leaveAppWorkingFolder({ cwd: installRoot, appDir, home, chdir: (dir) => seen.push(dir), win32: true }), true);
  assert.deepEqual(seen, [home]);
  seen.length = 0;
  assert.equal(leaveAppWorkingFolder({ cwd: home, appDir, home, chdir: (dir) => seen.push(dir), win32: true }), false);
  assert.deepEqual(seen, []);
  seen.length = 0;
  assert.equal(leaveAppWorkingFolder({
    cwd: portable, appDir: portable, home, chdir: (dir) => seen.push(dir), win32: true,
  }), true);
  assert.deepEqual(seen, [home]);
  seen.length = 0;
  assert.equal(leaveAppWorkingFolder({
    cwd: join(portable, "resources"), appDir: portable, home: portable, chdir: (dir) => seen.push(dir), win32: true,
  }), false, "never chdir into the app folder");
  assert.deepEqual(seen, []);
});

test("startup home falls back when Electron has no getPath", () => {
  const home = "C:\\Users\\person";
  assert.equal(userHome({ getPath: (name) => { assert.equal(name, "home"); return home; } }, () => "fallback"), home);
  assert.equal(userHome({}, () => home), home, "desktop tests stub app without getPath");
  assert.equal(userHome({ getPath: () => { throw new Error("no getPath"); } }, () => home), home);
  assert.equal(userHome({ getPath: () => "  " }, () => home), home);
});

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
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  const confirm = join(root, "confirm.cjs");
  await writeFile(confirm, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify(cfg)});`);
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: [confirm] }, confirmTimeoutMs: 15_000 };
  assert.equal(await runHelper(plan), "applied");
  if (journal.installRoot) {
    assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "old runtime", "the live folder stays");
    assert.equal((await readFile(join(journal.installRoot, desktopUpdate.WINDOWS_POINTER), "utf8")).trim(), journal.versionFolder);
    assert.equal(await readFile(join(journal.installRoot, journal.versionFolder, "Branch Agent.exe"), "utf8"), "new runtime");
    assert.equal(await readFile(join(journal.installRoot, journal.versionFolder, "resources/app.asar"), "utf8"), "new desktop asar");
  } else {
    assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "new runtime");
    assert.equal(await readFile(join(install.appDir, "resources/app.asar"), "utf8"), "new desktop asar");
    assert.equal(await readFile(join(`${install.appDir}.previous`, "Branch Agent.exe"), "utf8"), "old runtime");
  }
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

test("an unreadable pending record is discarded and logged, and the app starts", () => fixture(async ({ cfg, install }) => {
  const journal = join(cfg.dataDir, "desktop-update-pending.json");
  await writeFile(journal, '{"version":"0.4.5","phase":"sta');
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(journal), false, "the unreadable record is removed");
  assert.equal(await readFile(join(install.resourcesDir, "app.asar"), "utf8"), "old desktop asar", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update discarded: the record is unreadable \(.+\); starting the current build/);
}));

test("a staged whole app whose app.asar fails its SHA256 is discarded at launch, never swapped in", () => fixture(async ({ cfg, request, install }) => {
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.kind, "runtime");
  const asar = join(journal.staged, "resources", `app${desktopUpdate.STAGED_ASAR}`);
  const digest = createHash("sha256").update(await readFile(asar)).digest("hex");
  assert.equal(journal.stagedSha256, digest, "staging records the SHA256 of the whole app's app.asar");
  await writeFile(asar, "tampered desktop asar");
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(join(cfg.dataDir, "desktop-update-pending.json")), false, "the altered record is removed");
  assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "old runtime", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: app\.asar\.staged fails its SHA256/);
}, { runtime: true }));

test("a pending update whose folder vanished (ENOENT writing the helper) is discarded and the app starts", () => fixture(async ({ root, cfg, install }) => {
  // The staged file and its target exist and match the record, but the update's own folder is gone: the hand-off's
  // first write into it fails with ENOENT, as the 12:30Z launch did on payload/desktop-update-helper.js.
  const target = join(root, "Branch-Agent.AppImage"), staged = `${target}.update-0.4.5`;
  await writeFile(target, "old appimage"); await writeFile(staged, "new appimage");
  const stagedSha256 = createHash("sha256").update("new appimage").digest("hex");
  const journal = join(cfg.dataDir, "desktop-update-pending.json");
  await writeFile(journal, JSON.stringify({ version: "0.4.5", sha256: stagedSha256, kind: "appimage", staged, target, phase: "staged", stagedSha256,
    work: join(cfg.dataDir, "updates", "desktop-0.4.5-gone00") }));
  const launch = await launchHandOff(cfg, install);
  assert.deepEqual({ code: launch.code, stderr: launch.stderr }, { code: 0, stderr: "" });
  assert.equal(await exists(journal), false, "the record is removed");
  assert.equal(await exists(staged), false, "the orphaned staged file is removed");
  assert.equal(await readFile(target, "utf8"), "old appimage", "the installed app is untouched");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.5 discarded: ENOENT.*desktop-update-helper\.js.*; starting the current build/);
}));

/**
 * Two "volumes": the data folder (where updates are staged) and Applications. A rename between them fails with
 * EXDEV, as it does from an external data disk into /Applications.
 */
async function crossVolume(run) {
  const root = await mkdtemp(join(tmpdir(), "desktop-exdev-"));
  const dataVolume = join(root, "data-volume"), appVolume = join(root, "Applications");
  const dataDir = join(dataVolume, "data"), payload = join(dataDir, "updates", "desktop-0.4.5-abc123", "payload");
  const staged = join(payload, "Branch Agent.app"), target = join(appVolume, "Branch Agent.app");
  for (const [bundle, label] of [[staged, "new"], [target, "old"]]) {
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await mkdir(join(bundle, "Contents", "Resources"), { recursive: true });
    await writeFile(join(bundle, "Contents", "MacOS", "Branch Agent"), `${label} runtime`);
    await writeFile(join(bundle, "Contents", "Resources", label === "new" ? `app${desktopUpdate.STAGED_ASAR}` : "app.asar"), `${label} desktop asar`);
  }
  const plan = { journal: join(dataDir, "desktop-update-pending.json"), versionFile: join(dataDir, "desktop-update-version.txt"),
    rejectedFile: join(dataDir, "desktop-update-rejected.json"), log: join(dataDir, "desktop.log"), waitPid: 0,
    relaunch: { command: process.execPath, args: ["-e", `require("node:fs").rmSync(${JSON.stringify(join(dataDir, "desktop-update-pending.json"))}, { force: true })`] },
    confirmTimeoutMs: 15_000 };
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  plan.waitPid = exited.pid;
  await writeFile(plan.journal, JSON.stringify({ version: "0.4.5", sha256: "a".repeat(64), kind: "runtime", staged, target, phase: "staged" }));
  const side = path => path.startsWith(dataVolume) ? "data" : "apps";
  const calls = { copies: 0, renames: [] };
  const fs = {
    rename: async (source, to) => {
      calls.renames.push([source, to]);
      if (side(source) !== side(to)) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${source}' -> '${to}'`), { code: "EXDEV" });
      await rename(source, to);
    },
    copy: async (source, to) => { calls.copies++; await cp(source, to, { recursive: true, verbatimSymlinks: true }); },
    remove: path => rm(path, { recursive: true, force: true }),
  };
  try { await run({ root, appVolume, dataDir, staged, target, plan, fs, calls }); }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}
const leftovers = async dir => (await readdir(dir)).filter(name => name.includes(".incoming-") || name.includes(".failed-"));

test("EXDEV: a staged app on another volume is copied beside the app, then swapped in by a rename on that volume", () => crossVolume(async ({ appVolume, staged, target, plan, fs, calls }) => {
  assert.equal(await runHelper(plan, fs), "applied");
  assert.equal(calls.copies, 1, "the cross-volume move fell back to a copy");
  assert.equal(await readFile(join(target, "Contents", "MacOS", "Branch Agent"), "utf8"), "new runtime");
  assert.equal(await readFile(join(target, "Contents", "Resources", "app.asar"), "utf8"), "new desktop asar");
  assert.equal(await readFile(join(`${target}.previous`, "Contents", "MacOS", "Branch Agent"), "utf8"), "old runtime", "the previous app is kept for rollback");
  assert.deepEqual(await leftovers(appVolume), [], "no temp copy is left beside the app");
  assert.equal(await exists(join(staged, "Contents", "MacOS", "Branch Agent")), false, "the staged original is cleaned up once the copy is in place");
  for (const [source, to] of calls.renames.filter(([source]) => source === target || source.includes(".incoming-"))) {
    assert.equal(dirname(source), dirname(to), `the swap renames stay on the app's volume: ${source} -> ${to}`);
  }
  assert.match(await readFile(plan.log, "utf8"), /different volumes; copied the new copy beside the app/);
}));

test("EXDEV: a copy that fails leaves the installed app in place, removes the temp copy and keeps the update staged", () => crossVolume(async ({ appVolume, staged, target, plan, fs }) => {
  fs.copy = async (source, to) => {
    await mkdir(join(to, "Contents"), { recursive: true });
    await writeFile(join(to, "Contents", "partial"), "half a bundle");
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  };
  assert.equal(await runHelper(plan, fs), "kept");
  assert.equal(await readFile(join(target, "Contents", "MacOS", "Branch Agent"), "utf8"), "old runtime", "the installed app never moved");
  assert.equal(await exists(join(`${target}.previous`, "Contents", "MacOS", "Branch Agent")), false, "the installed app was never moved aside");
  assert.deepEqual(await leftovers(appVolume), [], "the partial temp copy is removed");
  assert.equal(await readFile(join(staged, "Contents", "MacOS", "Branch Agent"), "utf8"), "new runtime", "the staged copy stays for a retry");
  const journal = JSON.parse(await readFile(plan.journal, "utf8"));
  assert.equal(journal.phase, "staged"); assert.ok(journal.heldUntil > Date.now());
  assert.match(await readFile(plan.log, "utf8"), /could not bring the new copy beside the app \(Error: ENOSPC/);
}));

test("EXDEV: a new app that never confirms is rolled back without a cross-volume move", () => crossVolume(async ({ appVolume, target, plan, fs }) => {
  plan.relaunch = { command: process.execPath, args: ["-e", "setTimeout(() => {}, 4000)"] };
  plan.confirmTimeoutMs = 1500;
  assert.equal(await runHelper(plan, fs), "rolled-back");
  assert.equal(await readFile(join(target, "Contents", "MacOS", "Branch Agent"), "utf8"), "old runtime", "the previous app is back");
  assert.deepEqual(await leftovers(appVolume), [], "the failed copy is removed from beside the app");
  assert.equal(await exists(plan.journal), false);
  assert.equal(JSON.parse(await readFile(plan.rejectedFile, "utf8")).version, "0.4.5");
}));

test("a staged desktop app that was never applied is replaced by a newer release, and its folder is removed", async () => fixture(async ({ cfg, request, install, release }) => {
  const old = join(cfg.dataDir, "updates", "desktop-old");
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "app.asar.staged"), "old staged desktop");
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ version: "0.4.4", sha256: "c".repeat(64), kind: "asar",
    staged: join(old, "app.asar.staged"), target: join(install.resourcesDir, "app.asar"), phase: "staged", work: old }));
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.version, release.version, "the newest release is the one staged");
  assert.equal(await exists(join(old, "app.asar.staged")), false, "the replaced staged folder is removed");
  assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /desktop update 0\.4\.4 dropped: replaced by 0\.4\.5/);
}));

test("a staged desktop app of the same release, or one already applying, is kept as it is", async () => fixture(async ({ cfg, request, install, release }) => {
  await writeFile(join(cfg.dataDir, "desktop-update-version.txt"), `${release.version}\n`);
  let requests = 0;
  const counting = (...args) => { requests++; return request(...args); };
  const sameRelease = { version: release.version, sha256: "d".repeat(64), kind: "asar", staged: join(cfg.dataDir, "updates", "x", "app.asar.staged"), target: "t", phase: "staged" };
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify(sameRelease));
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, counting, install), false);
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ ...sameRelease, version: "0.4.4", phase: "applying" }));
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, counting, install), false);
  assert.equal(requests, 0, "nothing is downloaded over a kept record");
  assert.equal((await desktopUpdate.readDesktopJournal(cfg)).version, "0.4.4");
}));

test("a staged desktop app of the same release does not stop the engine and window from staging", async () => fixture(async ({ cfg, request, install, release }) => {
  await writeFile(join(cfg.dataDir, "desktop-update-version.txt"), `${release.version}\n`);
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ version: release.version, sha256: "e".repeat(64), kind: "asar",
    staged: join(cfg.dataDir, "updates", "y", "app.asar.staged"), target: "t", phase: "staged" }));
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const status = await updater.readComponentUpdateStatus(cfg);
  assert.equal(status.componentsPendingVersion, release.version, "the newest engine and window are staged beside the waiting desktop app");
}));

/** Old app folder is locked: renaming or deleting it (or its original files) fails with Access denied. */
function lockedFs(forbidden) {
  const original = new Set(["Branch Agent.exe", "resources"]);
  const locked = path => {
    if (path === forbidden) return true;
    const rel = path.startsWith(forbidden) ? path.slice(forbidden.length).replace(/^[\\/]/, "").split(/[\\/]/)[0] : "";
    return original.has(rel);
  };
  const err = (op, path) => Object.assign(new Error(`EPERM: Access is denied, ${op} '${path}'`), { code: "EPERM" });
  return {
    rename: async (source, to) => {
      if (locked(source) || locked(to)) throw err("rename", source);
      await rename(source, to);
    },
    copy: async (source, to) => {
      if (locked(to)) throw err("copy", to);
      await cp(source, to, { recursive: true, verbatimSymlinks: true });
    },
    remove: async path => {
      if (locked(path)) throw err("rm", path);
      await rm(path, { recursive: true, force: true });
    },
  };
}

test("Windows: a locked old folder is left in place and the pointer switches to a new version folder", () => fixture(async ({ root, cfg, request, install, release }) => {
  install.platform = "win32";
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.kind, "runtime");
  assert.equal(journal.installRoot, install.appDir);
  assert.match(journal.versionFolder, /^app-/);
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  const confirm = join(root, "confirm.cjs");
  await writeFile(confirm, `require(${JSON.stringify(join(dist, "desktop-update.js"))}).confirmDesktopUpdate(${JSON.stringify(cfg)});`);
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: [confirm] }, confirmTimeoutMs: 15_000 };
  assert.equal(await runHelper(plan, lockedFs(install.appDir)), "applied");
  assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "old runtime", "the locked folder is never renamed");
  assert.equal(await readFile(join(install.appDir, "resources/app.asar"), "utf8"), "old desktop asar");
  assert.equal((await readFile(join(install.appDir, desktopUpdate.WINDOWS_POINTER), "utf8")).trim(), journal.versionFolder);
  assert.equal(await readFile(join(install.appDir, journal.versionFolder, "Branch Agent.exe"), "utf8"), "new runtime");
  assert.equal(await readFile(join(install.appDir, journal.versionFolder, "resources/app.asar"), "utf8"), "new desktop asar");
  // The helper writes the one shared launcher source: the module the installer imports, copied unchanged into dist.
  assert.equal(await readFile(join(install.appDir, desktopUpdate.WINDOWS_LAUNCHER), "utf8"), launcher.windowsLauncherScript());
  assert.equal(await readFile(join(dist, "windows-launcher.mjs"), "utf8"), await readFile(new URL("./windows-launcher.mjs", import.meta.url), "utf8"));
  assert.equal(await exists(`${install.appDir}.previous`), false);
  assert.match(await readFile(plan.log, "utf8"), /left the live folder in place/);
}, { runtime: true }));

test("Windows: prune skips a locked old version folder and removes an unlocked one", async () => {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "win-prune-"));
  try {
    for (const name of ["app-old-aaaaaa", "app-locked-bbbbbb", "app-now-cccccc"]) {
      await mkdir(join(root, name), { recursive: true });
      await writeFile(join(root, name, "Branch Agent.exe"), name);
    }
    await writeFile(join(root, "current.txt"), "app-now-cccccc\n");
    await writeFile(join(root, "scratch.txt"), "not a version folder");
    const result = await desktopUpdate.pruneWindowsVersionFolders(root, ["app-now-cccccc"], {
      remove: async path => {
        if (path.endsWith("app-locked-bbbbbb")) throw Object.assign(new Error("EPERM: Access is denied"), { code: "EPERM" });
        await rm(path, { recursive: true, force: true });
      },
    });
    assert.equal(result.removed, 1);
    assert.equal(result.skipped, 1);
    assert.equal(await exists(join(root, "app-old-aaaaaa", "Branch Agent.exe")), false);
    assert.equal(await exists(join(root, "app-locked-bbbbbb", "Branch Agent.exe")), true);
    assert.equal(await exists(join(root, "app-now-cccccc", "Branch Agent.exe")), true);
    assert.equal(await exists(join(root, "scratch.txt")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows: a new app that never confirms switches the pointer back and leaves the old folder", () => fixture(async ({ cfg, request, install, release }) => {
  install.platform = "win32";
  assert.equal(await desktopUpdate.stageDesktopUpdate(cfg, release, request, install), true);
  const exited = spawn(process.execPath, ["-e", ""]); await new Promise(resolve => exited.on("exit", resolve));
  const plan = { journal: join(cfg.dataDir, "desktop-update-pending.json"), versionFile: join(cfg.dataDir, "desktop-update-version.txt"),
    rejectedFile: join(cfg.dataDir, "desktop-update-rejected.json"), log: join(cfg.dataDir, "desktop.log"), waitPid: exited.pid,
    relaunch: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 4000)"] }, confirmTimeoutMs: 1500 };
  assert.equal(await runHelper(plan, lockedFs(install.appDir)), "rolled-back");
  assert.equal(await readFile(join(install.appDir, "Branch Agent.exe"), "utf8"), "old runtime");
  assert.equal(await exists(join(install.appDir, desktopUpdate.WINDOWS_POINTER)), false);
  assert.equal(await exists(plan.journal), false);
}, { runtime: true }));

test("Windows asar-only updates stay in place when the release has no whole-app package", () => fixture(async ({ cfg, request, install }) => {
  install.platform = "win32";
  await updater.refreshComponentUpdate(cfg, request, { desktop: install });
  const journal = await desktopUpdate.readDesktopJournal(cfg);
  assert.equal(journal.kind, "asar");
  assert.equal(journal.installRoot, undefined);
}));

/** An install root after an update from an older build: shortcuts still name the old version folder. */
async function upgradedRoot(run) {
  const parent = join(tmpdir(), "Codex-session-files"); await mkdir(parent, { recursive: true });
  const base = await mkdtemp(join(parent, "win-launcher-"));
  const root = join(base, "Branch Agent"), dataDir = join(base, "data");
  try {
    for (const name of ["app-0.4.4-aaaaaa", "app-0.4.5-bbbbbb"]) {
      await mkdir(join(root, name, "resources"), { recursive: true });
      await writeFile(join(root, name, "Branch Agent.exe"), name);
      await writeFile(join(root, name, "resources", launcher.WINDOWS_LAUNCHER_RESOURCE), `launcher from ${name}`);
    }
    await mkdir(dataDir);
    await writeFile(join(root, "current.txt"), "app-0.4.5-bbbbbb\n");
    await writeFile(join(root, "previous.txt"), "\n");
    const appDir = join(root, "app-0.4.5-bbbbbb");
    const install = { appDir, resourcesDir: join(appDir, "resources"), executable: join(appDir, "Branch Agent.exe"),
      electronVersion: ELECTRON, nodePath: process.execPath, platform: "win32" };
    const links = new Map([
      ["Programs/Branch Agent.lnk", join(root, "app-0.4.4-aaaaaa", "Branch Agent.exe")],
      ["Desktop/Branch Agent.lnk", join(root, "app-0.4.4-aaaaaa", "Branch Agent.exe")],
      ["TaskBar/Branch Agent.lnk", join(root, "app-0.4.4-aaaaaa", "Branch Agent.exe")],
      ["Startup/Branch Agent.lnk", join(root, "app-0.4.4-aaaaaa", "Branch Agent.exe")],
      ["Desktop/Other.lnk", join(base, "Other", "Other.exe")],
    ]);
    const calls = { list: 0, retarget: [], repair: [] };
    const shortcuts = {
      list: async () => { calls.list++; return [...links].map(([path, target]) => ({ path, target })); },
      retarget: async (paths, to) => { calls.retarget.push([...paths]); for (const path of paths) links.set(path, to); },
      repairWorkingDirectory: async (paths) => { calls.repair.push([...paths]); },
    };
    await run({ root, cfg: { dataDir }, install, links, calls, shortcuts });
  } finally { await rm(base, { recursive: true, force: true }); }
}

test("Windows: an upgrade from shortcuts into a version folder retargets them to the stable launcher exactly once", () => upgradedRoot(async ({ root, cfg, install, links, calls, shortcuts }) => {
  const stable = join(root, launcher.WINDOWS_LAUNCHER_EXE);
  const changed = await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts);
  assert.deepEqual(changed.sort(), ["Desktop/Branch Agent.lnk", "Programs/Branch Agent.lnk", "Startup/Branch Agent.lnk", "TaskBar/Branch Agent.lnk"]);
  assert.equal(calls.retarget.length, 1, "one rewrite for all of them");
  assert.deepEqual(calls.repair[0].sort(), changed.sort(), "Start in is repaired to the user folder on the same pass");
  assert.equal(await readFile(stable, "utf8"), "launcher from app-0.4.5-bbbbbb", "placed from the running package");
  assert.equal(links.get("Programs/Branch Agent.lnk"), stable);
  assert.equal(links.get("Startup/Branch Agent.lnk"), stable);
  assert.equal(links.get("Desktop/Other.lnk"), join(root, "..", "Other", "Other.exe"), "another app's shortcut is left alone");
  assert.equal(await readFile(join(root, launcher.WINDOWS_LAUNCHER), "utf8"), launcher.windowsLauncherScript());
  assert.match(await readFile(join(cfg.dataDir, "desktop-shortcut-launcher.txt"), "utf8"), /working-dir=userprofile/);
  // Second launch: nothing to do, not even a look at the shortcuts.
  assert.deepEqual(await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts), []);
  assert.equal(calls.list, 1);
  assert.equal(calls.retarget.length, 1);
  assert.equal(calls.repair.length, 1);
  // Even with the record gone, links that already open the launcher are not retargeted; Start in is repaired once more.
  await rm(join(cfg.dataDir, "desktop-shortcut-launcher.txt"));
  assert.deepEqual(await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts), []);
  assert.equal(calls.list, 2);
  assert.equal(calls.retarget.length, 1);
  assert.equal(calls.repair.length, 2);
  // A launcher already at this revision (the installer's signed copy) is never replaced by the package's.
  await writeFile(stable, "signed by the installer");
  await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts);
  assert.equal(await readFile(stable, "utf8"), "signed by the installer");
}));

test("Windows: shortcut targets survive a prune of old version folders, and the launcher starts the current one", () => upgradedRoot(async ({ root, cfg, install, links, shortcuts }) => {
  await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts);
  await desktopUpdate.pruneWindowsInstall(install);
  assert.equal(await exists(join(root, "app-0.4.4-aaaaaa")), false, "the old version folder is pruned");
  for (const [path, target] of links) if (path.endsWith("Branch Agent.lnk")) assert.equal(await exists(target), true, `${path} still opens a file`);
  const fs = { readText: path => { try { return readFileSync(path, "utf8"); } catch { return undefined; } }, exists: path => existsSync(path) };
  assert.equal(launcher.windowsLaunchTarget(root, fs), join(root, "app-0.4.5-bbbbbb", "Branch Agent.exe"));
}));

test("Windows: a failed shortcut rewrite is tried again at the next launch", () => upgradedRoot(async ({ cfg, install, calls, shortcuts }) => {
  const failing = { ...shortcuts, retarget: async () => { throw new Error("powershell timed out"); } };
  await assert.rejects(desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, failing), /timed out/);
  assert.equal((await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts)).length, 4);
  assert.equal(calls.retarget.length, 1);
}));

test("Windows: an old launcher-only shortcut record still repairs Start in to the user folder", () => upgradedRoot(async ({ root, cfg, install, links, calls, shortcuts }) => {
  const stable = join(root, launcher.WINDOWS_LAUNCHER_EXE);
  for (const path of ["Programs/Branch Agent.lnk", "Desktop/Branch Agent.lnk", "TaskBar/Branch Agent.lnk", "Startup/Branch Agent.lnk"]) {
    links.set(path, stable);
  }
  await writeFile(stable, "already placed");
  await writeFile(join(root, launcher.WINDOWS_LAUNCHER_REVISION_FILE), `${launcher.WINDOWS_LAUNCHER_REVISION}\n`);
  await writeFile(join(cfg.dataDir, "desktop-shortcut-launcher.txt"), `${stable}\n`);
  assert.deepEqual(await desktopUpdate.ensureWindowsLauncher(cfg, install, () => undefined, shortcuts), []);
  assert.equal(calls.retarget.length, 0, "already-launcher links are not retargeted");
  assert.equal(calls.repair.length, 1);
  assert.deepEqual(calls.repair[0].sort(), ["Desktop/Branch Agent.lnk", "Programs/Branch Agent.lnk", "Startup/Branch Agent.lnk", "TaskBar/Branch Agent.lnk"]);
  assert.match(await readFile(join(cfg.dataDir, "desktop-shortcut-launcher.txt"), "utf8"), /working-dir=userprofile/);
  assert.equal(await readFile(stable, "utf8"), "already placed");
}));

test("off Windows there is no launcher to place and no shortcut is read", () => upgradedRoot(async ({ cfg, install }) => {
  const never = { list: async () => assert.fail("no shortcuts off Windows"), retarget: async () => assert.fail("no shortcuts off Windows") };
  assert.deepEqual(await desktopUpdate.ensureWindowsLauncher(cfg, { ...install, platform: "linux" }, () => undefined, never), []);
  assert.deepEqual(await desktopUpdate.ensureWindowsLauncher(cfg, { ...install, platform: "win32", appImage: "/x" }, () => undefined, never), []);
}));

const INSTALL = "C:\\Program Files\\Branch Agent";
const NODE_INSIDE = `${INSTALL}\\resources\\node\\node.exe`;
const SHELL_INSIDE = `${INSTALL}\\Branch Agent.exe`;
const ROOT = "C:\\Users\\Example\\AppData\\Local\\Programs\\Branch Agent";
const SHELL = `${ROOT}\\app-0.4.4-aaaaaa`;
const SHELL_EXE = `${SHELL}\\Branch Agent.exe`;
const ENGINE_NODE = `${SHELL}\\resources\\node\\node.exe`;
const HOME = "C:\\Users\\Example";
const CODEX = `${HOME}\\AppData\\Local\\BranchAgent\\updates\\release-engine\\codex.exe`;

function listedWindows(rows) {
  return holders.parseWindowsProcessList(JSON.stringify(rows));
}

test("a leftover process in the install folder is a holder and a process outside it is not", () => {
  const listed = listedWindows([
    { ProcessId: 4242, ExecutablePath: NODE_INSIDE, CommandLine: `"${NODE_INSIDE}" gateway` },
    { ProcessId: 4243, ExecutablePath: SHELL_INSIDE, CommandLine: `"${SHELL_INSIDE}"` },
    { ProcessId: 7, ExecutablePath: "C:\\Other\\Branch Agent\\Branch Agent.exe", CommandLine: "Branch Agent.exe" },
    { ProcessId: 8, ExecutablePath: "C:\\Program Files\\nodejs\\node.exe", CommandLine: `node.exe "${INSTALL}\\resources\\engine\\branch.mjs"` },
    { ProcessId: 9, ExecutablePath: "C:\\Program Files\\Branch Agent Extra\\Branch Agent.exe", CommandLine: "Branch Agent.exe" },
  ]);
  assert.deepEqual(holders.holdersInInstall(INSTALL, listed, new Set()).map(item => item.executable), [NODE_INSIDE, SHELL_INSIDE]);
  assert.equal(holders.pathInsideInstall(INSTALL, NODE_INSIDE), true);
  assert.equal(holders.pathInsideInstall(INSTALL, SHELL_INSIDE), true);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Other\\Branch Agent\\Branch Agent.exe"), false);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Program Files\\nodejs\\node.exe"), false);
  assert.equal(holders.pathInsideInstall(INSTALL, "C:\\Program Files\\Branch Agent Extra\\Branch Agent.exe"), false);
});

test("a process whose working directory is the shell folder is a holder and one outside is not", () => {
  const listed = listedWindows([
    { ProcessId: 31, ExecutablePath: "C:\\Windows\\System32\\cmd.exe", CommandLine: "cmd.exe", CurrentDirectory: SHELL },
    { ProcessId: 32, ExecutablePath: "C:\\Windows\\System32\\cmd.exe", CommandLine: "cmd.exe", CurrentDirectory: "C:\\Users\\Example\\Desktop" },
    { ProcessId: 33, ExecutablePath: CODEX, CommandLine: "codex.exe", CurrentDirectory: `${HOME}\\AppData\\Local\\BranchAgent\\updates\\release-engine` },
  ]);
  assert.deepEqual(holders.holdersInInstall(SHELL, listed, new Set()).map(item => item.pid), [31]);
});

test("a Windows PEB working directory with an NT prefix is still a holder", () => {
  assert.equal(holders.pathInsideInstall(SHELL, SHELL), true);
  assert.equal(holders.pathInsideInstall(SHELL, `\\??\\${SHELL}`), true, "PEB DosPath");
  assert.equal(holders.pathInsideInstall(SHELL, `\\\\?\\${SHELL}`), true, "Win32 long path");
  assert.equal(holders.pathInsideInstall(SHELL, `\\??\\${SHELL}\\resources`), true);
  assert.equal(holders.pathInsideInstall(SHELL, "\\??\\C:\\Other\\Branch Agent"), false);
  const listed = listedWindows([
    { ProcessId: 31, ExecutablePath: "C:\\Windows\\System32\\cmd.exe", CommandLine: "cmd.exe", CurrentDirectory: `\\??\\${SHELL}` },
    { ProcessId: 32, ExecutablePath: "C:\\Windows\\System32\\cmd.exe", CommandLine: "cmd.exe", CurrentDirectory: "\\??\\C:\\Users\\Example\\Desktop" },
  ]);
  assert.equal(listed.find(item => item.pid === 31).cwd, `\\??\\${SHELL}`);
  assert.deepEqual(holders.holdersInInstall(SHELL, listed, new Set()).map(item => item.pid), [31]);
});

test("releaseInstallFolderHolders asks then force-stops only processes inside the install", async () => {
  const listed = [
    { pid: 41, executable: ENGINE_NODE, command: `"${ENGINE_NODE}" branch.mjs gateway`, cwd: `${HOME}\\AppData\\Local\\BranchAgent\\updates\\release-engine`, files: [] },
    { pid: 42, executable: SHELL_EXE, command: `"${SHELL_EXE}"`, cwd: SHELL, files: [] },
    { pid: 43, executable: CODEX, command: "codex.exe", cwd: `${HOME}\\AppData\\Local\\BranchAgent\\updates\\release-engine`, files: [] },
    { pid: 44, executable: "C:\\Program Files\\nodejs\\node.exe", command: "node.exe branch.mjs", cwd: "C:\\Program Files\\nodejs", files: [] },
  ];
  const asked = [];
  const forced = [];
  const logs = [];
  const alive = new Set(listed.map(item => item.pid));
  const leftover = await holders.releaseInstallFolderHolders(SHELL, [99], {
    list: async () => listed,
    askExit: async pid => { asked.push(pid); },
    forceStop: async pid => { forced.push(pid); alive.delete(pid); },
    alive: pid => alive.has(pid),
    wait: async () => {},
    log: line => logs.push(line),
  }, 2);
  assert.deepEqual(asked, [41, 42]);
  assert.deepEqual(forced, [41, 42]);
  assert.deepEqual(leftover, []);
  for (const outsider of [43, 44]) {
    assert.equal(asked.includes(outsider), false);
    assert.equal(forced.includes(outsider), false);
  }
  assert.match(logs.join("\n"), new RegExp(ENGINE_NODE.replaceAll("\\", "\\\\")));
  assert.equal(logs.join("\n").includes(CODEX), false);
});

test("shortcut working directories inside the shell or install root are repaired to the user folder", () => {
  const link = { path: "C:\\Users\\Example\\Desktop\\Branch Agent.lnk", target: SHELL_EXE, workingDirectory: SHELL };
  assert.equal(holders.repairedWorkingDirectory(link, SHELL, HOME), HOME);
  assert.equal(holders.repairedWorkingDirectory({ ...link, workingDirectory: ROOT }, SHELL, HOME), HOME, "Setup Start in was the install root");
  assert.equal(holders.repairedWorkingDirectory({ ...link, workingDirectory: HOME }, SHELL, HOME), undefined);
  assert.equal(holders.repairedWorkingDirectory({ ...link, target: "C:\\Other\\Branch Agent\\Branch Agent.exe", workingDirectory: "C:\\Other\\Branch Agent" }, SHELL, HOME), undefined);
  assert.equal(holders.repairedWorkingDirectory({ ...link, target: CODEX, workingDirectory: SHELL }, SHELL, HOME), undefined);
  const launcherLink = {
    path: "C:\\Users\\Example\\Desktop\\Branch Agent.lnk",
    target: `${ROOT}\\Branch Agent Launcher.exe`,
    workingDirectory: ROOT,
  };
  assert.equal(holders.repairedWorkingDirectory(launcherLink, SHELL, HOME), HOME);
  const script = holders.shortcutRepairScript(SHELL_EXE, HOME);
  assert.match(script, /WorkingDirectory=\$work/);
  assert.match(script, /GetFolderPath\('Startup'\)/);
  assert.match(script, /TargetPath -ieq \$exe/);
  assert.equal(script.includes("Split-Path -Parent"), false);
  assert.equal(script.includes(HOME), true);
  assert.doesNotMatch(script, /BranchAgent/);
});

test("the engine node is copied outside the shell folder and other node binaries stay put", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-node-home-"));
  try {
    const shell = join(root, "Branch Agent-win32-x64");
    const bundled = join(shell, "resources", "node", "node");
    await mkdir(join(shell, "resources", "node"), { recursive: true });
    await writeFile(bundled, "bundled-node");
    const data = join(root, "BranchAgent");
    await mkdir(data);
    const outside = holders.nodeOutsideSwappedFolder(bundled, data);
    assert.equal(holders.pathInsideInstall(shell, outside), false);
    assert.equal(await readFile(outside, "utf8"), "bundled-node");
    assert.equal(holders.nodeOutsideSwappedFolder(process.execPath, data), process.execPath);
    assert.equal(holders.shellOfBundledNode(ENGINE_NODE), SHELL);
    assert.equal(holders.shellOfBundledNode("C:\\Program Files\\nodejs\\node.exe"), undefined);
    assert.equal(holders.pathInsideInstall(SHELL, CODEX), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the helper copies holders beside itself and releases them before an in-place rename", () => {
  const update = readFileSync(join(import.meta.dirname, "../src/desktop-update.ts"), "utf8");
  const helper = readFileSync(join(import.meta.dirname, "../src/desktop-update-helper.ts"), "utf8");
  const main = readFileSync(join(import.meta.dirname, "../src/main.ts"), "utf8");
  assert.match(update, /install-folder-holders\.js/);
  assert.match(helper, /releaseInstallFolderHolders/);
  assert.match(helper, /GetFolderPath\('Startup'\)/);
  const release = helper.indexOf("releaseInstallFolderHolders");
  const move = helper.indexOf("await move(journal.target, previous");
  assert.ok(release !== -1 && move !== -1 && release < move, "holders leave before the live folder is renamed");
  const nodeCopy = main.indexOf("cfg.nodePath = nodeOutsideSwappedFolder(cfg.nodePath, cfg.dataDir)");
  const install = main.indexOf("const install: DesktopInstall");
  assert.ok(nodeCopy !== -1 && install !== -1 && nodeCopy < install, "bundled node is copied before the install object uses it");
});

