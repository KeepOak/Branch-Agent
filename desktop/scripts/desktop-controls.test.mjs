// Desktop controls bridge: every OS call is a fake, so nothing on this computer changes.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createDesktopControls, registerDesktopControlsIpc, ringBitmap, branchShim, editUserPath, pathHas, DOWNLOAD_PAGES } =
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

test("defaults keep working on close, keep awake off, tray ring off", async () => fixture(async ({ deps }) => {
  const controls = createDesktopControls(deps);
  assert.deepEqual(await controls.get(), { keepWorking: true, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false });
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
  assert.ok(shim.includes('set /p BRANCH_GATEWAY_TOKEN=<"%BRANCH_DATA%\\gateway-token"'));
  assert.ok(shim.includes('"C:\\App\\node.exe" "%ENGINE%\\branch.mjs" %*'));
  assert.doesNotMatch(shim, /[0-9a-f]{64}/);
});

test("user Path edits add once and remove case-insensitively", () => {
  assert.equal(editUserPath("C:\\A;;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin\\;C:\\B", "C:\\Bin", true), "C:\\A;C:\\B;C:\\Bin");
  assert.equal(editUserPath("C:\\A;c:\\bin;C:\\B", "C:\\Bin", false), "C:\\A;C:\\B");
  assert.equal(pathHas("C:\\A;C:\\BIN\\", "C:\\Bin"), true);
  assert.equal(pathHas("C:\\A", "C:\\Bin"), false);
});
