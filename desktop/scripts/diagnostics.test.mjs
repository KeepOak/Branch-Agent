import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const dist = (name) => import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, name)));
const { redactDiagnosticText } = await dist("diagnostics-redact.js");
const { RotatingLog, uiEventLine } = await dist("diagnostics-log.js");
const { recentLines, readTail, reportReadme } = await dist("diagnostics-report.js");
const { zipStored, crc32 } = await dist("diagnostics-zip.js");

const NOW = "2026-10-09T12:00:00.000Z";

test("redaction removes secrets and addresses but keeps ordinary text", () => {
  const out = redactDiagnosticText(
    'token=abc123secretvalue authorization: Bearer eyJhbGciOi.payload.sig password "hunter2222" key sk-ABCDEFGHIJKLMNOPQRSTUV ghp_abcdefghijklmnopqrstuvwxyz0123456789 mail alice@example.com hash 0123456789abcdef0123456789abcdef0123456789abcdef and plain words stay',
  );
  assert.doesNotMatch(out, /abc123secretvalue|hunter2222|sk-ABCDEF|ghp_abcdef|alice@example|0123456789abcdef0123/);
  assert.match(out, /plain words stay/);
  assert.match(out, /\[redacted\]/);
  assert.match(out, /\[email\]/);
});

test("UI events keep only the whitelisted fields and reject unknown kinds", () => {
  assert.equal(uiEventLine({ kind: "message.sent", text: "hello" }, NOW), null);
  assert.equal(uiEventLine(null, NOW), null);
  const line = JSON.parse(uiEventLine({ kind: "action", name: "Record a voice note", role: "menuitem", text: "private words", extra: 1 }, NOW));
  assert.deepEqual(line, { ts: NOW, kind: "action", name: "Record a voice note", role: "menuitem" });
});

test("UI event labels drop addresses and invalid method names", () => {
  const mail = JSON.parse(uiEventLine({ kind: "dialog.open", name: "Send to alice@example.com" }, NOW));
  assert.equal(mail.name, "[omitted]");
  const req = JSON.parse(uiEventLine({ kind: "request", method: "chat.send", ok: true, ms: 12 }, NOW));
  assert.deepEqual(req, { ts: NOW, kind: "request", method: "chat.send", ok: true, ms: 12 });
  assert.equal(uiEventLine({ kind: "request", method: "chat send; rm", ok: false, code: "UNAVAILABLE", ms: -4 }, NOW), null);
  const coded = JSON.parse(uiEventLine({ kind: "request", method: "agents.list", ok: false, code: "UNAVAILABLE", ms: -4 }, NOW));
  assert.deepEqual(coded, { ts: NOW, kind: "request", method: "agents.list", ok: false, code: "UNAVAILABLE" });
  const place = JSON.parse(uiEventLine({ kind: "place.open", place: "inbox" }, NOW));
  assert.equal(place.place, "inbox");
  const alert = JSON.parse(uiEventLine({ kind: "alert", textId: "9f8e7d6c" }, NOW));
  assert.equal(alert.textId, "9f8e7d6c");
});

test("the UI event log rotates by size and keeps three files", () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-diag-"));
  try {
    const file = join(dir, "ui-events.log");
    const log = new RotatingLog(file, 200, 3);
    for (let i = 0; i < 40; i += 1) log.append(`{"n":${i},"pad":"${"x".repeat(40)}"}`);
    const files = log.paths();
    assert.equal(files.length, 3);
    assert.ok(existsSync(file));
    assert.ok(existsSync(`${file}.1`) && existsSync(`${file}.2`));
    assert.equal(existsSync(`${file}.3`), false);
    for (const path of files) assert.ok(readFileSync(path, "utf8").length <= 200 + 60, `${path} stays near the bound`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the report keeps only lines in the requested window and redacts them", () => {
  const cutoff = Date.parse("2026-10-09T11:30:00.000Z");
  const text = [
    "2026-10-09T11:00:00.000Z old launch",
    "2026-10-09T11:45:00.000Z engine stopped with token=zzzsecretzzz",
    "  continuation of the stop message",
    '{"ts":"2026-10-09T11:50:00.000Z","kind":"request","method":"chat.send","ok":false}',
    '{"ts":"2026-10-09T10:00:00.000Z","kind":"action","name":"old"}',
  ].join("\n");
  const lines = recentLines(text, cutoff);
  assert.equal(lines.length, 3);
  assert.doesNotMatch(lines.join("\n"), /zzzsecretzzz|old launch|"old"/);
  assert.match(lines[1], /continuation/);
});

test("reading a tail starts at a whole line", () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-tail-"));
  try {
    const file = join(dir, "desktop.log");
    writeFileSync(file, "first line here\nsecond line\nthird\n");
    const tail = readTail(file, 20);
    assert.equal(tail.startsWith("second"), true);
    assert.equal(readTail(join(dir, "missing.log"), 20), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the archive is a valid zip with the expected entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-zip-"));
  try {
    const file = join(dir, "report.zip");
    const data = Buffer.from("line one\nline two\n");
    writeFileSync(file, zipStored([{ name: "desktop.log", data }, { name: "README.txt", data: Buffer.from(reportReadme(30, NOW)) }], new Date(NOW)));
    execFileSync("unzip", ["-t", file], { stdio: "pipe" });
    assert.equal(execFileSync("unzip", ["-p", file, "desktop.log"]).toString(), data.toString());
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
