// This computer's permissions bridge: every OS call is a fake, so nothing prompts and no privacy setting changes.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { createOsPermissions, registerOsPermissionsIpc, mediaStatus, settingsUrl } = await import(pathToFileURL(join(dist, "os-permissions.js")));

function fake(platform, start = {}) {
  const media = { microphone: "granted", camera: "not-determined", ...start };
  const calls = [];
  const perms = createOsPermissions({
    platform,
    mediaStatus: kind => media[kind],
    askMedia: async kind => { calls.push(["ask", kind]); media[kind] = "granted"; return true; },
    openExternal: async url => { calls.push(["open", url]); },
  });
  return { perms, calls, media };
}

test("Electron's media answers read as allowed, not allowed or not asked yet", () => {
  assert.equal(mediaStatus("granted"), "allowed");
  assert.equal(mediaStatus("denied"), "denied");
  assert.equal(mediaStatus("restricted"), "denied");
  assert.equal(mediaStatus("not-determined"), "not-asked");
  assert.equal(mediaStatus("unknown"), "unknown");
});

test("macOS: microphone and camera are read; location and notifications are never guessed", () => {
  const { perms } = fake("darwin");
  assert.deepEqual(perms.get(), { microphone: "allowed", camera: "not-asked", location: "unknown", notifications: "unknown" });
});

test("Allow asks macOS only while it has not asked yet", async () => {
  const { perms, calls, media } = fake("darwin", { microphone: "denied" });
  assert.equal((await perms.request("camera")).camera, "allowed");
  assert.equal((await perms.request("microphone")).microphone, "denied");
  assert.equal((await perms.request("location")).location, "unknown");
  assert.deepEqual(calls, [["ask", "camera"]]);
  assert.equal(media.camera, "granted");
});

test("Windows never shows a prompt; Linux reads nothing", async () => {
  const win = fake("win32");
  assert.equal((await win.perms.request("camera")).camera, "not-asked");
  assert.deepEqual(win.calls, []);
  assert.deepEqual(fake("linux").perms.get(), { microphone: "unknown", camera: "unknown", location: "unknown", notifications: "unknown" });
});

test("each permission opens its own settings page", async () => {
  const { perms, calls } = fake("darwin");
  await perms.open("microphone");
  await perms.open("notifications");
  assert.deepEqual(calls.map(c => c[1]), [
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
  ]);
  assert.equal(settingsUrl("win32", "camera"), "ms-settings:privacy-webcam");
  assert.equal(settingsUrl("linux", "camera"), null);
  await assert.rejects(fake("linux").perms.open("camera"), /no settings page/);
});

test("only the owned served window may call, and only with a known permission", async () => {
  const handlers = new Map();
  const served = "http://127.0.0.1:1234/";
  const sender = { getURL: () => served, mainFrame: { url: served } };
  const { perms, calls } = fake("darwin");
  registerOsPermissionsIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, () => sender, served, perms);
  assert.deepEqual([...handlers.keys()].sort(), ["branch-desktop:permissions:get", "branch-desktop:permissions:open", "branch-desktop:permissions:request"]);
  const owned = { sender, senderFrame: sender.mainFrame };
  assert.equal((await handlers.get("branch-desktop:permissions:get")(owned)).microphone, "allowed");
  const stranger = { getURL: () => "https://example.com/", mainFrame: { url: "https://example.com/" } };
  await assert.rejects(handlers.get("branch-desktop:permissions:get")({ sender: stranger, senderFrame: stranger.mainFrame }), /owned served window/);
  await assert.rejects(handlers.get("branch-desktop:permissions:open")(owned, "contacts"), /microphone, camera, location or notifications/);
  await assert.rejects(handlers.get("branch-desktop:permissions:request")(owned, { name: "camera" }), /microphone, camera/);
  assert.deepEqual(calls, []);
});
