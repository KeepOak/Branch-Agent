import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareFileEdit } from "./edit-diff.js";

for (const [name, source, search, replacement, expected] of [
  [
    "case insensitive",
    "keep\nHello World\nend\n",
    "hello world",
    "updated",
    "keep\nupdated\nend\n",
  ],
  [
    "ignored indentation",
    "before\n  function f() {\n    return 1;\n  }\nafter\n",
    "function f() { return 1; }",
    "done",
    "before\n  done\nafter\n",
  ],
  [
    "trimmed outer whitespace",
    "before\nconst value = 1;\nafter\n",
    "\n const value = 1; \n",
    "const value = 2;",
    "before\nconst value = 2;\nafter\n",
  ],
  ["Unicode source offsets", "İ keep\nTARGET\n", "target", "changed", "İ keep\nchanged\n"],
  ["mixed terminators", "keep\r\nHELLO\nlast\r\n", "hello", "changed", "keep\r\nchanged\nlast\r\n"],
] as const) {
  test(`Continue fallback in real edit planner: ${name}`, () => {
    const result = prepareFileEdit(
      source,
      [{ oldText: search, newText: replacement }],
      "fixture.txt",
    );
    assert.equal(result.changed, true);
    if (!result.changed) {
      throw new Error("Expected changed plan");
    }
    assert.equal(result.content, expected);
    assert.ok(result.receipt.patch);
  });
}
test("Continue fallback rejects multiple source spans before mutation", () => {
  assert.throws(
    () => prepareFileEdit("HELLO\nhello\n", [{ oldText: "HeLLo", newText: "bye" }], "fixture"),
    /2 occurrences/,
  );
});
test("Continue fallback preserves planner overlap rejection", () => {
  assert.throws(
    () =>
      prepareFileEdit(
        "HELLO WORLD\n",
        [
          { oldText: "hello world", newText: "a" },
          { oldText: "WORLD", newText: "b" },
        ],
        "fixture",
      ),
    /overlap/,
  );
});
test("exact match takes precedence over looser source strategies", () => {
  const result = prepareFileEdit(
    "HELLO\nhello\n",
    [{ oldText: "hello", newText: "bye" }],
    "fixture",
  );
  assert.ok(result.changed);
  if (result.changed) {
    assert.equal(result.content, "HELLO\nbye\n");
  }
});
