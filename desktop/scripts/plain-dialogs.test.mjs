// Private #1089 (Linux pass): the desktop's own error boxes showed raw text: "A JavaScript error occurred in the main
// process" with the uncaught exception's stack and file paths, and the update and stop-engine failures with the raw
// error message. A native error box has no level and no Details fold, so it says what happened in plain words with one
// next step, and the raw text goes to the desktop log (each call site logs it first).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("the update and stop-engine boxes say the next step, not the raw error", () => {
  for (const title of ["Branch couldn't finish the update", "Branch couldn't stop its engine"]) {
    const found = box(title);
    assert.ok(found, title);
    assert.match(found.body, /^"[^`$]*"$/, `${title}: a fixed sentence`);
    assert.doesNotMatch(found.body, /^(?:msg|message|detail|error\.message|String\()/, `${title}: not the raw error`);
  }
});

test("each plain box's raw text still reaches the log", () => {
  assert.match(main, /log\(`uncaught main-process error: \$\{detail\}`\)/);
  assert.match(main, /log\(`update failed: \$\{msg\}`\)/);
  assert.match(main, /log\(`stop completely failed: \$\{message\}`\)/);
});
