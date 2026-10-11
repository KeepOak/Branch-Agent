import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST || fileURLToPath(new URL("../dist/", import.meta.url));
const { createVoiceController, voiceDefaults, mayUseMicrophone } = await import(pathToFileURL(join(dist, "voice.js")));

test("only owned top-level audio requests receive microphone permission", () => {
  const served = "http://127.0.0.1:1234/";
  assert.equal(mayUseMicrophone(true, served, `${served}?route=chat`, true, ["audio"]), true);
  for (const args of [[false, served, true, ["audio"]], [true, "https://example.test/", true, ["audio"]],
    [true, "http://127.0.0.1:12345/", true, ["audio"]], [true, served, false, ["audio"]],
    [true, served, true, ["video"]], [true, served, true, ["audio", "video"]], [true, served, true, []]]) {
    assert.equal(mayUseMicrophone(args[0], served, args[1], args[2], args[3]), false);
  }
});

test("shortcut conflicts preserve settings, persistence reloads and disabling releases the shortcut", async () => {
  const dir = await mkdtemp(join(tmpdir(), "branch-voice-"));
  try {
    const bound = new Map(); let actions = 0; const changes = [];
    const deps = { file: join(dir, "voice.json"), shortcuts: {
      register(key, fn) { if (key === "Alt+F1") return false; bound.set(key, fn); return true; },
      unregister(key) { bound.delete(key); } }, action: () => actions++, changed: s => changes.push(s) };
    const controller = createVoiceController(deps);
    assert.equal(controller.get().listening, "off");
    const enabled = { ...voiceDefaults, listening: "push-to-talk" };
    controller.set(enabled); bound.get(enabled.shortcut)(); assert.equal(actions, 1);
    assert.throws(() => controller.set({ ...enabled, shortcut: "Alt+F1" }), /unavailable/);
    assert.deepEqual(controller.get(), enabled); assert.equal(bound.size, 1);
    assert.deepEqual(createVoiceController(deps).get(), enabled);
    assert.throws(() => controller.set({ ...enabled, shortcut: "invalid" }), /Invalid/);
    controller.set({ ...enabled, dictation: false }); assert.equal(bound.size, 0);
    controller.set(enabled); controller.dispose(); assert.equal(bound.size, 0); assert.equal(changes.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("preload forwards voice calls and removes event subscriptions", async () => {
  const calls = []; const listeners = new Map(); let bridge;
  const ipcRenderer = {
    sendSync: () => ({ gatewayUrl: "ws://127.0.0.1:1234", gatewayToken: "fixture" }),
    invoke: async (...args) => { calls.push(args); },
    on: (name, fn) => listeners.set(name, fn),
    removeListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); },
  };
  runInNewContext(await readFile(join(dist, "preload.js"), "utf8"), {
    exports: {}, process: { platform: "linux" }, window: { addEventListener() {} },
    require: name => { assert.equal(name, "electron"); return { ipcRenderer,
      contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } } }; },
  });
  const settings = { listening: "off", dictation: true, microphone: "", shortcut: "Control+Space" };
  await bridge.voice.get(); await bridge.voice.set(settings); await bridge.voice.requestMicrophone();
  assert.deepEqual(calls, [["branch-desktop:voice:get"], ["branch-desktop:voice:set", settings], ["branch-desktop:voice:microphone"]]);
  let actions = 0; let changed;
  const offAction = bridge.voice.onAction(() => actions++);
  const offChanged = bridge.voice.onChanged(value => { changed = value; });
  listeners.get("branch-desktop:voice:action")({ secret: true });
  listeners.get("branch-desktop:voice:changed")({ secret: true }, settings);
  assert.equal(actions, 1); assert.equal(changed, settings);
  offAction(); offChanged();
  assert.equal(listeners.has("branch-desktop:voice:action"), false);
  assert.equal(listeners.has("branch-desktop:voice:changed"), false);
});
