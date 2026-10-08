import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const { runHelper } = await import(pathToFileURL(join(dist, "desktop-update-helper.js")));
await import("./desktop-update-helper-cases.mjs");
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
