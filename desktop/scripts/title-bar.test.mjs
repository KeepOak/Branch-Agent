// Header-integrated title bar: the overlay options and the window's colour/height messages. No Electron needed.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
if (!dist) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to current strict-compiled source");
const { parseTitleBarOverlay, registerTitleBarIpc, titleBarOptions, STARTING_OVERLAY } = await import(pathToFileURL(join(dist, "title-bar.js")));

const SERVED = "http://127.0.0.1:19032/";
const owner = { getURL: () => SERVED, mainFrame: { url: SERVED } };

test("Windows hides the native title bar and keeps the window buttons as an overlay", () => {
  assert.deepEqual(titleBarOptions("win32"), { titleBarStyle: "hidden", titleBarOverlay: STARTING_OVERLAY });
  assert.deepEqual(titleBarOptions("darwin"), {});
  assert.deepEqual(titleBarOptions("linux"), {});
});

test("only plain colours and a header-sized height are accepted", () => {
  assert.deepEqual(parseTitleBarOverlay({ color: " #0f1418 ", symbolColor: "rgb(174, 186, 195)", height: 51.4 }),
    { color: "#0f1418", symbolColor: "rgb(174, 186, 195)", height: 51 });
  for (const bad of [null, "x", { color: "red", symbolColor: "#fff", height: 51 }, { color: "#fff", symbolColor: "url(x)", height: 51 },
    { color: "#fff", symbolColor: "#000", height: 10 }, { color: "#fff", symbolColor: "#000", height: 400 }, { color: "#fff", symbolColor: "#000" }]) {
    assert.equal(parseTitleBarOverlay(bad), null);
  }
});

test("the overlay follows the owned window only", () => {
  const listeners = {};
  const applied = [];
  registerTitleBarIpc({ on: (channel, fn) => { listeners[channel] = fn; } }, () => owner, SERVED, (o) => applied.push(o));
  const send = listeners["branch-desktop:title-bar"];
  send({ sender: owner, senderFrame: owner.mainFrame }, { color: "#f6f8f9", symbolColor: "#3a4751", height: 51 });
  const stranger = { getURL: () => "https://example.com/", mainFrame: { url: "https://example.com/" } };
  send({ sender: stranger, senderFrame: stranger.mainFrame }, { color: "#000000", symbolColor: "#ffffff", height: 51 });
  send({ sender: owner, senderFrame: owner.mainFrame }, { color: "javascript:", symbolColor: "#fff", height: 51 });
  assert.deepEqual(applied, [{ color: "#f6f8f9", symbolColor: "#3a4751", height: 51 }]);
});
