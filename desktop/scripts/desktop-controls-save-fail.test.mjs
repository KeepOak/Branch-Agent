// Private #1093: a settings save that fails (other than a full disk) puts the old value back and rejects, so the window
// shows why and the main process never keeps an unsaved value. Every OS call is a fake, so nothing on this computer changes.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createDesktopControls, readSettings } = await import(pathToFileURL(join(dist, "desktop-controls.js")));

async function fixture(run) {
  const parent = join(tmpdir(), "claude-session-files", "desktop-controls-save-fail");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const calls = [];
  const state = { login: false, onPath: false };
  const deps = {
    settingsFile: join(root, "desktop-settings.json"),
    login: { get: () => state.login, set: on => { calls.push(["login", on]); state.login = on; } },
    cli: { installed: async () => state.onPath, install: async () => { calls.push(["cli-install"]); state.onPath = true; },
      uninstall: async () => { calls.push(["cli-uninstall"]); state.onPath = false; } },
    tray: { usage: (left, on) => calls.push(["tray", left, on]) },
    openExternal: async url => calls.push(["open", url]),
  };
  try { await run({ root, deps, calls, state }); } finally { await rm(root, { recursive: true, force: true }); }
}

const denied = () => Object.assign(new Error("EACCES: permission denied, open 'desktop-settings.json'"), { code: "EACCES", errno: -13, syscall: "open" });

test("a failed save rejects, keeps the old value and tells nobody it changed", async () => fixture(async ({ deps, calls }) => {
  const changes = [];
  const writeFile = () => { throw denied(); };
  const controls = createDesktopControls({ ...deps, writeFile, onChange: settings => changes.push(settings) });
  await assert.rejects(controls.set("autoApplyUpdates", false), /EACCES/);
  assert.equal((await controls.get()).autoApplyUpdates, true, "get() keeps the saved value");
  assert.equal(controls.settings().autoApplyUpdates, true, "settings() keeps the saved value");
  assert.deepEqual(changes, [], "onChange is not called for a save that failed");
  await assert.rejects(controls.set("trayUsage", true), /EACCES/);
  assert.equal(controls.settings().trayUsage, false);
  assert.deepEqual(calls, [], "the tray is not switched for a save that failed");
  assert.equal(readSettings(deps.settingsFile).autoApplyUpdates, true);
}));

test("a full disk still keeps the new value in memory without throwing", async () => fixture(async ({ deps }) => {
  const { onDiskFullChange } = await import(pathToFileURL(join(dist, "disk-full.js")));
  const stop = onDiskFullChange(() => {});
  const changes = [];
  const writeFile = () => { throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC", errno: -28, syscall: "write" }); };
  const controls = createDesktopControls({ ...deps, writeFile, onChange: settings => changes.push(settings) });
  try {
    assert.equal((await controls.set("autoApplyUpdates", false)).autoApplyUpdates, false, "no throw on a full disk");
    assert.equal(controls.settings().autoApplyUpdates, false, "the new value stays in memory");
    assert.equal(changes.length, 1);
  } finally { stop(); }
}));
