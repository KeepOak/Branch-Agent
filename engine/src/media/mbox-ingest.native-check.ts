import assert from "node:assert/strict";
import { test } from "node:test";
import { ingestMbox } from "./mbox-ingest.ts";
const message = (headers: string, body: string) => `From sender@example.test Sat Jan 01 00:00:00 2022\nFrom: Sender <sender@example.test>\n${headers}\n\n${body}\n`;
const ingest = (text: string, metadata = {}) => ingestMbox({
  buffer: Buffer.from(text), filename: "archive.mbox", sourceUrl: "file:///archive.mbox",
  published: "2022-01-01T00:00:00.000Z", metadata, tokenizeString: (text) => text.length,
});
test("real parser emits separate email documents and source metadata", async () => {
  const result = await ingest(message("Subject: First. mail", "first body") + message("Subject: Second mail", "second body"));
  assert.equal(result.success, true);
  assert.equal(result.reason, null);
  assert.equal(result.documents.length, 2);
  const [first, second] = result.documents;
  assert.ok(first && second);
  assert.equal(first.title, "First-mail.mbox");
  assert.equal(second.title, "Second-mail.mbox");
  assert.equal(first.docAuthor, '"Sender" <sender@example.test>');
  assert.equal(first.url, "file:///archive.mbox");
  assert.equal(first.published, "2022-01-01T00:00:00.000Z");
  assert.equal(first.pageContent.trim(), "first body");
  assert.equal(second.pageContent.trim(), "second body");
  assert.equal(first.token_count_estimate, first.pageContent.length);
  assert.equal(first.wordCount, first.pageContent.split(" ").length);
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
});
test("upload metadata overrides sender and document defaults", async () => {
  const { documents } = await ingest(message("Subject: Hello", "body"), {
    title: "Import", docAuthor: "Owner", description: "Description", docSource: "Archive", chunkSource: "Chunk",
  });
  assert.deepEqual(documents.map(({ title, docAuthor, description, docSource, chunkSource }) =>
    ({ title, docAuthor, description, docSource, chunkSource })), [{
      title: "Import - Hello.mbox", docAuthor: "Owner", description: "Description", docSource: "Archive", chunkSource: "Chunk",
    }]);
});
test("HTML-only multipart with attachment keeps readable text and links", async () => {
  const { documents } = await ingest(message('Subject: HTML\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="part"',
    '--part\nContent-Type: text/html; charset=utf-8\n\n<p>Hello <a href="https://example.test/ref">reference</a></p><img src="https://tracker.test/pixel"><script>bad()</script>\n--part\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="data.bin"\nContent-Transfer-Encoding: base64\n\nAAEC\n--part--'));
  assert.equal(documents.length, 1);
  assert.match(documents[0]!.pageContent, /Hello reference/);
  assert.match(documents[0]!.pageContent, /https:\/\/example.test\/ref/);
  assert.doesNotMatch(documents[0]!.pageContent, /tracker|bad\(\)|AAEC/);
});
test("plain text wins over HTML alternative", async () => {
  const { documents } = await ingest(message('Subject: Alternative\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary="part"',
    '--part\nContent-Type: text/plain\n\nplain wins\n--part\nContent-Type: text/html\n\n<p>html loses</p>\n--part--'));
  assert.equal(documents[0]!.pageContent.trim(), "plain wins");
});
test("subjectless messages use source numbering and empty bodies are skipped", async () => {
  const { documents } = await ingest(message("Subject: Empty", "") + message("", "readable") + message("", "next"));
  assert.deepEqual(documents.map((doc) => doc.title), ["msg_1-archive.mbox", "msg_2-archive.mbox"]);
  assert.equal(documents[0]!.description, "No description found.");
  assert.equal(documents[0]!.docSource, "Mbox message file uploaded by the user.");
});
test("empty archive resolves failure instead of hanging in upstream parser", async () => {
  assert.deepEqual(await ingest(""), { success: false, reason: "No mail items found in archive.mbox.", documents: [] });
});
test("source success with only unreadable messages retains empty documents", async () => {
  assert.deepEqual(await ingest(message("Subject: Empty", "")), { success: true, reason: null, documents: [] });
});
test("RFC2047 subject and base64 Unicode body are decoded by real mailparser", async () => {
  const { documents } = await ingest(message("Subject: =?UTF-8?B?Q2Fmw6k=?=\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: base64", Buffer.from("Bonjour café").toString("base64")));
  assert.equal(documents[0]!.title, "Cafe.mbox");
  assert.equal(documents[0]!.pageContent.trim(), "Bonjour café");
});
