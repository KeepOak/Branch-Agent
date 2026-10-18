// Private #1089 (Linux pass): the desktop's own error boxes showed raw text: "A JavaScript error occurred in the main
// process" with the uncaught exception's stack and file paths, and the update and stop-engine failures with the raw
// error message. A native error box has no level and no Details fold, so it says what happened in plain words with one
// next step, and the raw text goes to the desktop log (each call site logs it first).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error("Compile the exact desktop source before testing");
const require = createRequire(import.meta.url);
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { isPlainSentence, plainDialogText, STOP_FAILED_PLAIN, UPDATE_FAILED_PLAIN } = require(join(dist, "plain-dialog.js"));
const { TRUNKS_STILL_WORKING } = require(join(dist, "service-update.js"));
const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/main.ts"), "utf8");
const boxes = [...main.matchAll(/dialog\.showErrorBox\(\s*("(?:[^"\\]|\\.)*")\s*,\s*(.+)\);\s*$/gm)].map(([, title, body]) => ({ title: JSON.parse(title), body: body.trim() }));
const box = (title) => boxes.find((b) => b.title === title);

test("the uncaught-error box is plain: no stack, no 'JavaScript error', no 'Uncaught Exception'", () => {
  assert.equal(box("A JavaScript error occurred in the main process"), undefined);
  const plain = box("Branch hit a problem");
  assert.ok(plain, "the box keeps a plain title");
  assert.match(plain.body, /^"[^`$]*"$/, "the body is a fixed sentence, not the error");
  assert.doesNotMatch(main, /Uncaught Exception:\\n\$\{detail\}/);
});

test("the update and stop-engine boxes pass the failure through the plain filter, never the raw error as is", () => {
  for (const [title, raw, fallback] of [["Branch couldn't finish the update", "msg", "UPDATE_FAILED_PLAIN"], ["Branch couldn't stop its engine", "message", "STOP_FAILED_PLAIN"]]) {
    const found = box(title);
    assert.ok(found, title);
    assert.equal(found.body, `plainDialogText(${raw}, ${fallback})`, `${title}: filtered, with a plain fallback`);
  }
  for (const fallback of [UPDATE_FAILED_PLAIN, STOP_FAILED_PLAIN]) assert.ok(isPlainSentence(fallback), fallback);
});

test("Branch's own written sentences pass unchanged: the busy refusal reaches the update box as is", () => {
  assert.equal(plainDialogText(TRUNKS_STILL_WORKING, UPDATE_FAILED_PLAIN), TRUNKS_STILL_WORKING);
  assert.equal(plainDialogText("Trunks are still working. Update when they finish.", UPDATE_FAILED_PLAIN), "Trunks are still working. Update when they finish.");
  const ownWords = "The update failed and the previous engine did not come back; Branch Agent restarts its service at the next launch";
  assert.equal(plainDialogText(ownWords, UPDATE_FAILED_PLAIN), ownWords);
});

test("raw failure text still becomes the plain fallback: stacks, error class and code names, paths, hosts, URLs", () => {
  const raw = [
    "TypeError: Cannot read properties of undefined (reading 'pid')\n    at restartEngine (main.js:1785:12)",
    "GatewayReadinessTimeoutError: the gateway did not answer",
    "spawn branch ENOENT",
    "ERR_INVALID_ARG_TYPE",
    "Cannot open /opt/branch/engine/branch.mjs",
    "Cannot open C:\\Program Files\\Branch\\engine",
    "connect ECONNREFUSED 127.0.0.1:18789",
    "the engine at localhost did not answer",
    "fetch failed for https://updates.example.com/manifest.json",
    "",
  ];
  for (const text of raw) assert.equal(plainDialogText(text, UPDATE_FAILED_PLAIN), UPDATE_FAILED_PLAIN, JSON.stringify(text));
  assert.equal(plainDialogText("service stop exited with code 1", STOP_FAILED_PLAIN), STOP_FAILED_PLAIN);
});

test("each plain box's raw text still reaches the log", () => {
  assert.match(main, /log\(`uncaught main-process error: \$\{detail\}`\)/);
  assert.match(main, /log\(`update failed: \$\{msg\}`\)/);
  assert.match(main, /log\(`stop completely failed: \$\{message\}`\)/);
});
