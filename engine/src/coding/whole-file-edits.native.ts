import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWholeFileEdits } from "./whole-file-edits.ts";
import { applyWholeFileResponse } from "./whole-file-write-adapter.ts";

// Adapted parser/write assertions from pinned Aider tests/basic/test_wholefile.py.
async function apply(response: string, files: string[], fence?: readonly [string, string]) {
  const written = new Map<string, string>();
  const edits = await applyWholeFileResponse(response, files, {
    execute: async (_id, args) => { written.set(args.path, args.content); return {}; },
  }, { callId: "source-fixture", fence });
  return { written, edited: edits.map((edit) => edit.path) };
}

it("source test_update_files", async () => {
  const { written, edited } = await apply("sample.txt\n```\nUpdated content\n```", ["sample.txt"]);
  assert.ok(edited.includes("sample.txt"));
  assert.equal(written.get("sample.txt"), "Updated content\n");
});
it("source test_update_files_with_existing_fence (selection supplied by fence owner)", async () => {
  const { written, edited } = await apply("sample.txt\n<source>\nUpdated content\n</source>", ["sample.txt"], ["<source>", "</source>"]);
  assert.ok(edited.includes("sample.txt"));
  assert.equal(written.get("sample.txt"), "Updated content\n");
});
it("source test_update_files_bogus_path_prefix", async () => {
  const { written, edited } = await apply("path/to/sample.txt\n```\nUpdated content\n```", ["sample.txt"]);
  assert.ok(edited.includes("sample.txt"));
  assert.equal(written.get("sample.txt"), "Updated content\n");
});
it("source test_update_files_not_in_chat", async () => {
  const { written, edited } = await apply("sample.txt\n```\nUpdated content\n```", []);
  assert.ok(edited.includes("sample.txt"));
  assert.equal(written.get("sample.txt"), "Updated content\n");
});
it("source test_update_files_no_filename_single_file_in_chat", async () => {
  const content = "def accumulate(collection, operation):\n    return [operation(x) for x in collection]\n";
  const response = "Here's the modified `accumulate.py` file that implements the `accumulate` function as per the given instructions:\n\n```\n" + content + "```\n\nThis implementation uses a list comprehension to apply the `operation` function to each element of the `collection` and returns the resulting list.";
  const { written, edited } = await apply(response, ["accumulate.py"]);
  assert.ok(edited.includes("accumulate.py"));
  assert.equal(written.get("accumulate.py"), content);
});
it("source test_update_files_earlier_filename", async () => {
  const response = "\nHere is a new version of `a.txt` for you to consider:\n\n```\nafter a\n```\n\nAnd here is `b.txt`:\n\n```\nafter b\n```\n";
  const { written, edited } = await apply(response, ["a.txt", "b.txt"]);
  assert.ok(edited.includes("a.txt")); assert.ok(edited.includes("b.txt"));
  assert.equal(written.get("a.txt"), "after a\n"); assert.equal(written.get("b.txt"), "after b\n");
});
it("source test_update_hash_filename", async () => {
  const { written, edited } = await apply("\n\n### a.txt\n```\nafter a\n```\n\n### b.txt\n```\nafter b\n```\n", ["a.txt", "b.txt"]);
  assert.ok(edited.includes("a.txt")); assert.ok(edited.includes("b.txt"));
  assert.equal(written.get("a.txt"), "after a\n"); assert.equal(written.get("b.txt"), "after b\n");
});
it("source test_update_named_file_but_extra_unnamed_code_block", async () => {
  const content = "new\ncontent\ngoes\nhere\n";
  const response = "Here's the modified `hello.py` file that implements the `accumulate` function as per the given instructions:\n\n```\n" + content + "```\n\nThis implementation uses a list comprehension to apply the `operation` function to each element of the `collection` and returns the resulting list.\nRun it like this:\n\n```\npython {sample_file}\n```\n\n";
  const { written, edited } = await apply(response, ["hello.py"]);
  assert.ok(edited.includes("hello.py")); assert.equal(written.get("hello.py"), content);
});
it("source test_full_edit parser output retains one final newline (model loop excluded)", async () => {
  const content = "new\ntwo\nthree";
  const { written } = await apply("\nDo this:\n\nsample.txt\n```\n" + content + "\n```\n\n", ["sample.txt"]);
  assert.equal(written.get("sample.txt"), content + "\n");
});
it("host refuses new-file proposal; no write-success claim", async () => {
  const written = new Map();
  await assert.rejects(applyWholeFileResponse("foo.js\n```\nprint(\"Hello, World!\")\n```", [], {
    execute: async () => ({ isError: true }),
  }, { callId: "denied" }), /Whole-file write failed/);
  assert.equal(written.has("foo.js"), false);
});
it("source filename priority: explicit block beats saw/chat guesses", () => {
  const result = parseWholeFileEdits("`a.txt`\n\n```\nguess\n```\na.txt\n```\nexplicit\n```", ["a.txt"]);
  assert.deepEqual(result, [{ path: "a.txt", filenameSource: "block", content: "explicit\n" }]);
});
it("partial blocks and CRLF preserve original content", () => {
  assert.equal(parseWholeFileEdits("a.txt\r\n```\r\nfirst\r\nlast", ["a.txt"])[0]!.content, "first\r\nlast");
});
it("missing filename throws before invoking writer", async () => {
  let invoked = false;
  await assert.rejects(applyWholeFileResponse("```\ncontent\n```", [], { execute: async () => { invoked = true; return {}; } }, { callId: "missing" }), /No filename provided/);
  assert.equal(invoked, false);
});
it("aborted adapter cannot start later writes", async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  await assert.rejects(applyWholeFileResponse("a\n```\none\n```\nb\n```\ntwo\n```", [], {
    execute: async (_id, args) => { calls.push(args.path); controller.abort(); return {}; },
  }, { callId: "abort", signal: controller.signal }));
  assert.deepEqual(calls, ["a"]);
});
