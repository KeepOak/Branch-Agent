// Desktop controls bridge: every OS call is a fake, so nothing on this computer changes.
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createDesktopControls, readSettings, registerDesktopControlsIpc, ringBitmap, branchShim, branchShShim, editUserPath, pathHas, DOWNLOAD_PAGES,
  branchPosixShim, branchCommandOwner, posixBranchCommand, BRANCH_COMMAND_MARKER, LEGACY_BRANCH_COMMAND_MARKER } =
  await import(pathToFileURL(join(dist, "desktop-controls.js")));

async function fixture(run) {
  const parent = join(tmpdir(), "claude-session-files", "desktop-controls");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const calls = [];
  const state = { login: false, onPath: false, nextBlocker: 7 };
  const deps = {
    settingsFile: join(root, "desktop-settings.json"),
    login: { get: () => state.login, set: on => { calls.push(["login", on]); state.login = on; } },
    awake: { start: () => { calls.push(["awake-start"]); return state.nextBlocker; }, stop: id => calls.push(["awake-stop", id]) },
    cli: { installed: async () => state.onPath, install: async () => { calls.push(["cli-install"]); state.onPath = true; },
      uninstall: async () => { calls.push(["cli-uninstall"]); state.onPath = false; } },
    tray: { usage: (left, on) => calls.push(["tray", left, on]) },
    openExternal: async url => calls.push(["open", url]),
  };
  try { await run({ root, deps, calls, state }); } finally { await rm(root, { recursive: true, force: true }); }
}

test("defaults keep working and auto-apply on, keep awake and tray ring off", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  assert.deepEqual(await controls.get(), { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, agentControl: false, startWithWindows: false, branchOnPath: false });
}));

test("letting agents use the window is off by default, saved, and read at the next launch", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("agentControl", true)).agentControl, true);
  assert.deepEqual(calls, []);
  assert.equal(readSettings(deps.settingsFile).agentControl, true);
  await controls.set("agentControl", false);
  assert.equal(readSettings(deps.settingsFile).agentControl, false);
}));

test("Start with Windows goes to the login item, not the settings file", async () => fixture(async ({ deps, calls, state }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("startWithWindows", true)).startWithWindows, true);
  assert.deepEqual(calls, [["login", true]]);
  state.login = false; // turned off elsewhere, in the Startup apps list
  assert.equal((await controls.get()).startWithWindows, false);
}));

test("keep awake holds one blocker, saves, and is reapplied at launch", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  await controls.set("keepAwake", true);
  await controls.set("keepAwake", true);
  assert.deepEqual(calls, [["awake-start"]]);
  assert.equal(JSON.parse(await readFile(deps.settingsFile, "utf8")).keepAwake, true);
  const relaunched = createDesktopControls(deps);
  relaunched.apply();
  assert.deepEqual(calls.at(-1), ["awake-start"]);
  relaunched.dispose();
  assert.deepEqual(calls.at(-1), ["awake-stop", 7]);
  await controls.set("keepAwake", false);
  assert.deepEqual(calls.at(-1), ["awake-stop", 7]);
}));

test("keep working when the window closes is saved and read back", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  await controls.set("keepWorking", false);
  assert.equal(createDesktopControls(deps).settings().keepWorking, false);
}));

test("the branch command installs and removes through the cli adapter", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  assert.equal((await controls.set("branchOnPath", true)).branchOnPath, true);
  assert.equal((await controls.set("branchOnPath", false)).branchOnPath, false);
  assert.deepEqual(calls, [["cli-install"], ["cli-uninstall"]]);
}));

test("tray ring follows the usage only while the setting is on", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  controls.trayUsage(42);
  await controls.set("trayUsage", true);
  controls.trayUsage(140);
  assert.deepEqual(calls, [["tray", 42, false], ["tray", 42, true], ["tray", 100, true]]);
}));

test("Get it opens only the known download pages", async () => fixture(async ({ deps, calls }) => {
  const controls = createDesktopControls(deps);
  await controls.openDownload("windows");
  await controls.openDownload("iphone");
  await assert.rejects(controls.openDownload("https://example.com"), /No download page/);
  await assert.rejects(controls.openDownload("__proto__"), /No download page/);
  assert.deepEqual(calls, [["open", "https://github.com/KeepOak/Branch-Agent/releases/latest"], ["open", DOWNLOAD_PAGES.iphone]]);
  for (const url of Object.values(DOWNLOAD_PAGES)) assert.match(url, /^https:\/\//);
}));

test("unknown controls and non-boolean values are refused", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  await assert.rejects(controls.set("format", true), /Unknown desktop control/);
  await assert.rejects(controls.set("keepAwake", "yes"), /on or off/);
}));

test("IPC answers only the owned served window", async () => fixture(async ({ deps, calls }) => {
  const handlers = new Map(), listeners = new Map();
  const ipc = { handle: (c, f) => handlers.set(c, f), on: (c, f) => listeners.set(c, f) };
  const frame = { url: "http://127.0.0.1:19032/" };
  const owner = { getURL: () => frame.url, mainFrame: frame };
  registerDesktopControlsIpc(ipc, () => owner, "http://127.0.0.1:19032/", createDesktopControls(deps));
  const ok = { sender: owner, senderFrame: frame };
  const strangerFrame = { url: "https://elsewhere.test/" };
  const stranger = { sender: { getURL: () => strangerFrame.url, mainFrame: strangerFrame }, senderFrame: strangerFrame };
  assert.equal((await handlers.get("branch-desktop:controls:set")(ok, "startWithWindows", true)).startWithWindows, true);
  await assert.rejects(handlers.get("branch-desktop:controls:set")(stranger, "startWithWindows", false), /owned served window/);
  await assert.rejects(handlers.get("branch-desktop:controls:open-download")(stranger, "windows"), /owned served window/);
  listeners.get("branch-desktop:controls:tray-usage")(stranger, 50);
  listeners.get("branch-desktop:controls:tray-usage")(ok, 50);
  assert.deepEqual(calls, [["login", true], ["tray", 50, false]]);
}));

test("ring bitmap draws the share left as an arc over a faint track", () => {
  const size = 32, px = (img, x, y) => [...img.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
  const half = ringBitmap(50, size);
  assert.equal(half.length, size * size * 4);
  assert.equal(px(half, 16, 16)[3], 0, "the middle stays clear");
  assert.equal(px(half, 28, 16)[3], 255, "right side (first half, clockwise from top) is filled");
  assert.equal(px(half, 3, 16)[3], 110, "left side is the track");
  assert.notDeepEqual(px(ringBitmap(10, size), 17, 2).slice(0, 3), px(ringBitmap(80, size), 17, 2).slice(0, 3), "low turns amber");
});

test("branch shim reads the published engine and token at run time", () => {
  const shim = branchShim({ dataDir: "C:\\Data", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(shim.includes('set /p ENGINE=<"%BRANCH_DATA%\\engine-current.txt"'));
  // The engine that runs, not a staged one still waiting to be applied.
  assert.ok(shim.indexOf("engine-current.txt") < shim.indexOf('set /p ENGINE=<"%BRANCH_DATA%\\engine-running.txt"'));
  assert.ok(shim.includes('set /p BRANCH_GATEWAY_TOKEN=<"%BRANCH_DATA%\\gateway-token"'));
  // The configured port is the default; the live port an update moved the engine to wins.
  assert.ok(shim.indexOf('set "BRANCH_GATEWAY_PORT=19031"') < shim.indexOf('set /p BRANCH_GATEWAY_PORT=<"%BRANCH_DATA%\\gateway-port"'));
  assert.ok(shim.includes('"C:\\App\\node.exe" "%ENGINE%\\branch.mjs" %*'));
  assert.doesNotMatch(shim, /[0-9a-f]{64}/);
});

test("Git Bash shim reads the same files, drops CR and passes arguments through", () => {
  const shim = branchShShim({ dataDir: "C:\\Data's", engineDir: "C:\\App\\engine", nodePath: "C:\\App\\node.exe", gatewayPort: 19031 });
  assert.ok(shim.startsWith("#!/bin/sh\n"));
  assert.ok(shim.includes("data='C:/Data'\\''s'"));
  assert.ok(shim.includes("tr -d '\\r'"));
  assert.ok(shim.indexOf("engine-current.txt") < shim.indexOf('if [ -f "$data/engine-running.txt" ]'));
  // An empty read (never expected: the desktop renames the file into place) keeps the configured port.
  assert.ok(shim.includes(`if [ -f "$data/gateway-port" ]; then live=$(head -n 1 "$data/gateway-port" | tr -d '\\r'); if [ -n "$live" ]; then BRANCH_GATEWAY_PORT=$live; fi; fi`));
  assert.ok(shim.indexOf("BRANCH_GATEWAY_PORT=19031") < shim.indexOf("$data/gateway-port"));
  // As the cmd shim: a long-running `branch mcp serve` finds the desktop's gateway-port again after an update.
  assert.ok(shim.includes("BRANCH_DATA='C:\\Data'\\''s'"));
  assert.match(shim, /export BRANCH_DATA /);
  assert.ok(shim.includes(`exec 'C:/App/node.exe' "$engine/branch.mjs" "$@"`));
  assert.doesNotMatch(shim, /\r/);
});
/** A packaged install as it ships now: the app code is sealed in app.asar (no Resources/app/dist/cli.js), node sits
 *  beside it, and the engine the app runs is the unpacked copy named in the data folder's engine-*.txt files. */
async function packagedLayout(root) {
  const app = join(root, "Applications", "Branch Agent.app");
  const resources = join(app, "Contents", "Resources");
  const data = join(root, "Library", "Application Support", "BranchAgent");
  await mkdir(join(resources, "node"), { recursive: true });
  await writeFile(join(resources, "app.asar"), "sealed archive: only Electron reads inside it");
  // The bundled node: here a stand-in that hands over to the node running the tests.
  const nodePath = join(resources, "node", "node");
  await writeFile(nodePath, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  await chmod(nodePath, 0o755);
  const engine = async (name) => {
    const dir = join(data, "updates", name, "engine");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "branch.mjs"), `const e = process.env;
console.log(JSON.stringify({ engine: ${JSON.stringify(name)}, args: process.argv.slice(2), home: e.BRANCH_HOME, state: e.BRANCH_STATE_DIR,
  config: e.BRANCH_CONFIG_PATH, profile: e.BRANCH_PROFILE, port: e.BRANCH_GATEWAY_PORT, token: e.BRANCH_GATEWAY_TOKEN, data: e.BRANCH_DATA }));\n`);
    return dir;
  };
  const published = await engine("release-published"), running = await engine("release-running");
  await writeFile(join(data, "engine-current.txt"), `${published}\n`);
  await writeFile(join(data, "gateway-token"), "fixture-token\n");
  await writeFile(join(data, "gateway-port"), "19045\n");
  const command = join(root, "home", ".local", "bin", "branch");
  // The earlier installer's command, exactly as it was written before the app moved into app.asar.
  await mkdir(join(root, "home", ".local", "bin"), { recursive: true });
  await writeFile(command, ["#!/bin/sh", LEGACY_BRANCH_COMMAND_MARKER, "# Removing Branch Agent removes this file too.",
    "ELECTRON_RUN_AS_NODE=1", `exec '${nodePath}' '${join(resources, "app", "dist", "cli.js")}' "$@"`, ""].join("\n"));
  await chmod(command, 0o755);
  const cfg = { dataDir: data, engineDir: join(resources, "engine"), nodePath, gatewayPort: 19031 };
  return { app, resources, data, published, running, command, cfg };
}

const posixOnly = { skip: process.platform === "win32" && "the macOS and Linux command is a sh script" };

test("the macOS and Linux branch command runs the unpacked engine of a packaged (app.asar) install", posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "branch command "));
  try {
    const { data, published, running, command, cfg } = await packagedLayout(root);
    const stale = spawnSync(command, ["--version"], { encoding: "utf8" });
    assert.notEqual(stale.status, 0, "the earlier command finds no dist/cli.js in a packaged app");
    assert.match(stale.stderr, /dist\/cli\.js/);

    const cli = posixBranchCommand(command, () => branchPosixShim(cfg));
    assert.equal(branchCommandOwner(command), "installer");
    assert.equal(await cli.installed(), false, "the broken command does not count as installed");
    cli.refresh();
    assert.equal(branchCommandOwner(command), "app", "launch takes the earlier installer's command over");
    assert.equal(await cli.installed(), true);
    const text = await readFile(command, "utf8");
    assert.equal(text.split("\n")[1], BRANCH_COMMAND_MARKER);
    assert.doesNotMatch(text, /dist\/cli\.js|app\.asar/);
    assert.equal((await stat(command)).mode & 0o111, 0o111, "the command stays executable");

    const run = (...args) => JSON.parse(execFileSync(command, args, { encoding: "utf8", env: { PATH: process.env.PATH } }));
    const first = run("status", "--json", "it's a \"quoted\" arg");
    assert.deepEqual(first, { engine: "release-published", args: ["status", "--json", "it's a \"quoted\" arg"],
      home: join(data, "home"), state: join(data, "home", ".branch"), config: join(data, "home", ".branch", "branch.json"),
      profile: "default", port: "19045", token: "fixture-token", data });
    // The engine actually running wins over a published one that has not been applied yet.
    await writeFile(join(data, "engine-running.txt"), `${running}\n`);
    assert.equal(run().engine, "release-running");
    // With no live port recorded, the configured one is used.
    await rm(join(data, "gateway-port"));
    assert.equal(run().port, "19031");
    assert.ok(published);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the macOS and Linux branch command installs, refreshes and removes only its own file", posixOnly, async () => {
  const root = await mkdtemp(join(tmpdir(), "branch command "));
  try {
    const { command, cfg } = await packagedLayout(root);
    const cli = posixBranchCommand(command, () => branchPosixShim(cfg));
    await cli.uninstall();
    assert.equal(branchCommandOwner(command), "none", "turning it off removes the earlier installer's command too");
    cli.refresh();
    assert.equal(branchCommandOwner(command), "none", "a launch never creates the command");
    await cli.install();
    assert.equal(await cli.installed(), true);
    await cli.uninstall();
    assert.equal(await cli.installed(), false);

    await writeFile(command, "#!/bin/sh\necho someone else's branch\n");
    await assert.rejects(cli.install(), /another program's branch command/);
    cli.refresh();
    await cli.uninstall();
    assert.equal(await readFile(command, "utf8"), "#!/bin/sh\necho someone else's branch\n", "another program's file is left as it was");
    await rm(command);
    await symlink(join(root, "elsewhere"), command);
    assert.equal(branchCommandOwner(command), "other", "a link is never followed or replaced");
    await assert.rejects(cli.install(), /another program's branch command/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("user Path edits add once and remove case-insensitively", () => {
  assert.equal(editUserPath("C:\\A;;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin\\;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin;C:\\B", "C:\\Bin", false), "C:\\A;C:\\B");
  assert.equal(pathHas("C:\\A;C:\\BIN\\", "C:\\Bin"), true);
  assert.equal(pathHas("C:\\A", "C:\\Bin"), false);
});

test("close policy and tray click follow the controls (mocked Electron, no window or tray)", async () => {
  const { createRequire } = await import("node:module");
  const { EventEmitter } = await import("node:events");
  const require = createRequire(import.meta.url), Module = require("node:module"), originalLoad = Module._load;
  let tray;
  class Tray extends EventEmitter { constructor() { super(); tray = this; } setToolTip() {} setContextMenu() {} destroy() {} }
  Module._load = function (request, ...rest) {
    return request === "electron" ? { Tray, Menu: { buildFromTemplate: v => v } } : originalLoad.call(this, request, ...rest);
  };
  try {
    const { keepWindowResident } = require(join(dist, "resident-window.js"));
    const app = new EventEmitter(), win = new EventEmitter();
    Object.assign(win, { hidden: false, hide() { this.hidden = true; }, show() { this.hidden = false; }, focus() {}, isMinimized: () => false, restore() {} });
    let keep = true, clicks = 0;
    keepWindowResident(app, win, "icon.ico", { platform: "win32", keepRunning: () => keep, onTrayClick: () => clicks++ });
    const close = () => { const e = { prevented: false, preventDefault() { this.prevented = true; } }; win.emit("close", e); return e.prevented; };
    assert.equal(close(), true, "on: closing hides to the tray");
    keep = false;
    assert.equal(close(), false, "off: closing ends Branch");
    tray.emit("click");
    assert.equal(clicks, 1);
  } finally { Module._load = originalLoad; }
});

test("launch refreshes an existing branch command and never installs one", async () => fixture(async ({ deps, calls }) => {
  let refreshed = 0;
  deps.cli.refresh = () => { refreshed++; calls.push(["cli-refresh"]); };
  const controls = createDesktopControls(deps);
  controls.apply();
  assert.equal(refreshed, 1);
  assert.ok(!calls.some(([name]) => name === "cli-install"));
  deps.cli.refresh = () => { throw new Error("locked"); };
  assert.doesNotThrow(() => createDesktopControls(deps).apply());
  controls.dispose();
}));
