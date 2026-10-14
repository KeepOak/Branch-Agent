import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const updater = await import(pathToFileURL(join(dist, "component-update.js")));
const desktopUpdate = await import(pathToFileURL(join(dist, "desktop-update.js")));
const { runHelper } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
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
