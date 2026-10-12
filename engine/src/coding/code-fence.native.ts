import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_FENCES, chooseCodeFence } from "./code-fence.js";
import { buildCodingFileContext } from "./file-context-prompt.js";

test("ported test_coder.test_choose_fence: existing triple backticks select another fence", () => {
  assert.notEqual(chooseCodeFence(["this contains\n```\nbackticks"])[0], "```");
});
test("ported wholefile existing fence fixture and formatting", () => {
  const content = "\nHere is some quoted text:\n```\nQuote!\n```\n";
  const result = buildCodingFileContext({ editable: [{ path: "sample.txt", content }] });
  assert.notEqual(result.fence[0], "```");
  assert.equal(result.editable, `\nsample.txt\n${result.fence[0]}\n${content}${result.fence[1]}\n`);
});
test("source default is triple backticks, including empty input", () => {
  assert.deepEqual(chooseCodeFence([]), ["```", "```"]);
  assert.deepEqual(chooseCodeFence(["normal source"]), ["```", "```"]);
});
test("every ordered source fence can be selected", () => {
  for (let index = 0; index < CODE_FENCES.length; index++) {
    assert.deepEqual(chooseCodeFence(CODE_FENCES.slice(0, index).map(([open]) => open)), CODE_FENCES[index]);
  }
});
test("closing marker collisions also exclude the fence", () => {
  assert.deepEqual(chooseCodeFence(["```\n````\n</source> trailing"]), ["<code>", "</code>"]);
});
test("source checks line starts, not trimmed or arbitrary inline occurrences", () => {
  assert.deepEqual(chooseCodeFence(["  ```\ninline ```"]), ["```", "```"]);
});
test("Python splitlines boundaries retain source collision behavior", () => {
  for (const boundary of ["\n", "\r", "\r\n", "\v", "\f", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"]) {
    assert.deepEqual(chooseCodeFence([`text${boundary}\`\`\``]), ["````", "````"]);
  }
});
test("all collisions retain source fallback and exact warning", () => {
  const warnings: string[] = [];
  assert.deepEqual(chooseCodeFence(CODE_FENCES.map(([open]) => open), (message) => warnings.push(message)), ["```", "```"]);
  assert.deepEqual(warnings, ["Unable to find a fencing strategy! Falling back to: ```...```"]);
});
test("successful selection does not warn", () => {
  chooseCodeFence(["```"], () => assert.fail("unexpected warning"));
});
test("read-only files influence one fence for both prompt sections", () => {
  const result = buildCodingFileContext({ editable: [{ path: "main.ts", content: "const x = 1;\n" }], readOnly: [{ path: "README.md", content: "```\nexample\n```\n" }] });
  assert.deepEqual(result.fence, ["````", "````"]);
  assert.equal(result.editable, "\nmain.ts\n````\nconst x = 1;\n````\n");
  assert.equal(result.readOnly, "\nREADME.md\n````\n```\nexample\n```\n````\n");
});
test("unreadable and image files omitted, empty files retained, source content unchanged", () => {
  const result = buildCodingFileContext({ editable: [{ path: "none", content: null }, { path: "image.png", content: "```", isImage: true }, { path: "empty", content: "" }, { path: "raw", content: "last line" }] });
  assert.deepEqual(result.fence, ["````", "````"]);
  assert.equal(result.editable, "\nempty\n````\n````\n\nraw\n````\nlast line````\n");
  assert.equal(result.readOnly, "");
});
