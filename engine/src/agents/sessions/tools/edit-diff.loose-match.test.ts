import { describe, expect, it } from "vitest";
import { prepareFileEdit } from "./edit-diff.js";

// Continue's findSearchMatch strategies (CODING-0002) locate text that the exact and
// Unicode-normalized matches miss. The edit still fails; the error says where to copy from.
function notFoundMessage(source: string, oldText: string): string {
  try {
    prepareFileEdit(source, [{ oldText, newText: "replacement" }], "fixture.txt");
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the edit to be refused");
}

describe("edit planner loose-match hint", () => {
  it("points at a line that differs only in letter case", () => {
    expect(notFoundMessage("keep\nHello World\nend\n", "hello world")).toContain(
      "The text matches line 2 when ignoring letter case.",
    );
  });

  it("points at a block that differs only in whitespace and line breaks", () => {
    const message = notFoundMessage(
      "before\n  function f() {\n    return 1;\n  }\nafter\n",
      "function f() { return 1; }",
    );
    expect(message).toContain("The text matches lines 2-4 when ignoring all whitespace.");
  });

  it("keeps the indentation hint next to the trimmed-match pointer", () => {
    const message = notFoundMessage("      const value = 42;\n", "            const value = 42;");
    expect(message).toContain(
      "The text matches line 1 when ignoring leading and trailing whitespace.",
    );
    expect(message).toContain("indentation differs (expected 12 spaces, found 6 spaces)");
  });

  it("skips case folding that would shift source offsets", () => {
    // "İ".toLowerCase() is two UTF-16 units, so the case-insensitive strategy is skipped.
    expect(notFoundMessage("İ keep\nTARGET\n", "target")).not.toContain("when ignoring");
  });

  it("gives no pointer when the loose text appears more than once", () => {
    expect(notFoundMessage("HELLO\nHello\n", "hello")).not.toContain("when ignoring");
  });

  it("never applies a loose match", () => {
    expect(() =>
      prepareFileEdit("keep\nHello World\n", [{ oldText: "hello world", newText: "x" }], "f.txt"),
    ).toThrow(/Could not find the exact text/);
  });
});
