import { describe, expect, it } from "vitest";
import { gapBetween, parsePatch, splitRows, type Hunk } from "./diff";

describe("parsePatch", () => {
  it("reads a two-hunk patch into hunks with correct old/new line numbers", () => {
    const patch = `diff --git a/prices.md b/prices.md
--- a/prices.md
+++ b/prices.md
@@ -1,4 +1,5 @@
-Oakfield: $40
+Oakfield: $38.50
 Brightline: $41
+Staples: $46
 same
@@ -20,2 +21,2 @@ ## Delivery
-unknown
+3 days
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);

    // First hunk: line 1, old start
    const h1 = hunks[0]!;
    expect(h1.oldStart).toBe(1);
    expect(h1.newStart).toBe(1);
    expect(h1.lines).toHaveLength(5);
    expect(h1.lines[0]).toEqual({ kind: "del", text: "Oakfield: $40", oldNo: 1 });
    expect(h1.lines[1]).toEqual({ kind: "add", text: "Oakfield: $38.50", newNo: 1 });
    expect(h1.lines[2]).toEqual({ kind: "ctx", text: "Brightline: $41", oldNo: 2, newNo: 2 });
    expect(h1.lines[3]).toEqual({ kind: "add", text: "Staples: $46", newNo: 3 });
    expect(h1.lines[4]).toEqual({ kind: "ctx", text: "same", oldNo: 3, newNo: 4 });

    // Second hunk: line 20, with header text
    const h2 = hunks[1]!;
    expect(h2.oldStart).toBe(20);
    expect(h2.newStart).toBe(21);
    expect(h2.header).toBe("## Delivery");
    expect(h2.lines).toHaveLength(2);
    expect(h2.lines[0]).toEqual({ kind: "del", text: "unknown", oldNo: 20 });
    expect(h2.lines[1]).toEqual({ kind: "add", text: "3 days", newNo: 21 });
  });

  it("handles trailing newline correctly without creating a phantom context line", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 first
-second
+second changed
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "ctx", text: "first", oldNo: 1, newNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "del", text: "second", oldNo: 2 });
    expect(hunks[0]!.lines[2]).toEqual({ kind: "add", text: "second changed", newNo: 2 });
  });

  it("keeps a real last context line when the patch text ends with a newline", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " first",
      "-old",
      "+new",
      " last",
      "",
    ].join("\n");
    const hunks = parsePatch(patch);
    expect(hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["ctx", "first"],
      ["del", "old"],
      ["add", "new"],
      ["ctx", "last"],
    ]);
    expect(hunks[0]!.lines[3]).toEqual({ kind: "ctx", text: "last", oldNo: 3, newNo: 3 });
  });

  it("handles 'No newline at end of file' marker", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
 first
-second
\\ No newline at end of file
+second
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "ctx", text: "first", oldNo: 1, newNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "del", text: "second", oldNo: 2 });
    expect(hunks[0]!.lines[2]).toEqual({ kind: "add", text: "second", newNo: 2 });
  });

  it("handles added-only files", () => {
    const patch = `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,3 @@
+first line
+second line
+third line
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(0);
    expect(hunks[0]!.newStart).toBe(1);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "add", text: "first line", newNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "add", text: "second line", newNo: 2 });
    expect(hunks[0]!.lines[2]).toEqual({ kind: "add", text: "third line", newNo: 3 });
  });

  it("handles deleted-only files", () => {
    const patch = `diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1,3 +0,0 @@
-first line
-second line
-third line
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(1);
    expect(hunks[0]!.newStart).toBe(0);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "del", text: "first line", oldNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "del", text: "second line", oldNo: 2 });
    expect(hunks[0]!.lines[2]).toEqual({ kind: "del", text: "third line", oldNo: 3 });
  });

  it("keeps a real blank context line (space-prefixed) and still drops the trailing newline", () => {
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,4 +1,4 @@",
      " first",
      " ",
      "-old line",
      "+new line",
      "",
    ].join("\n");
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(4);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "ctx", text: "first", oldNo: 1, newNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "ctx", text: "", oldNo: 2, newNo: 2 });
    expect(hunks[0]!.lines[2]).toEqual({ kind: "del", text: "old line", oldNo: 3 });
    expect(hunks[0]!.lines[3]).toEqual({ kind: "add", text: "new line", newNo: 3 });
  });

  it("normalizes CRLF line endings to LF", () => {
    const patch = "diff --git a/file.txt b/file.txt\r\n--- a/file.txt\r\n+++ b/file.txt\r\n@@ -1,1 +1,1 @@\r\n-old\r\n+new\r\n";
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(2);
    expect(hunks[0]!.lines[0]).toEqual({ kind: "del", text: "old", oldNo: 1 });
    expect(hunks[0]!.lines[1]).toEqual({ kind: "add", text: "new", newNo: 1 });
  });

  it("ignores file headers before the first hunk", () => {
    const patch = `diff --git a/file.txt b/file.txt
index abc123..def456 100644
--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,1 @@
-old
+new
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(2);
  });
});

describe("gapBetween", () => {
  it("reports the unchanged-line count between hunks", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old first
+new first
 context
@@ -20,1 +20,1 @@
-old second
+new second
`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    // Last old line in the first hunk is 2; the next hunk starts at 20.
    // Changes shows this as "17 unchanged lines" (preview: chgGapPC18).
    expect(gapBetween(hunks[0]!, hunks[1]!)).toBe(17);
  });

  it("returns 0 when hunks are adjacent", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old first
+new first
 context
@@ -3,1 +3,1 @@
-old second
+new second
`;
    const hunks = parsePatch(patch);
    expect(gapBetween(hunks[0]!, hunks[1]!)).toBe(0);
  });

  it("handles hunks with only additions (no old line numbers)", () => {
    const h1: Hunk = {
      header: "",
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "ctx", text: "context", oldNo: 1, newNo: 1 },
        { kind: "add", text: "added", newNo: 2 },
      ],
    };
    const h2: Hunk = {
      header: "",
      oldStart: 5,
      newStart: 6,
      lines: [{ kind: "del", text: "deleted", oldNo: 5 }],
    };
    expect(gapBetween(h1, h2)).toBe(3);
  });

  it("uses oldStart - 1 when first hunk has no old line numbers", () => {
    const h1: Hunk = {
      header: "",
      oldStart: 3,
      newStart: 1,
      lines: [{ kind: "add", text: "added", newNo: 1 }],
    };
    const h2: Hunk = {
      header: "",
      oldStart: 10,
      newStart: 5,
      lines: [{ kind: "ctx", text: "context", oldNo: 10, newNo: 5 }],
    };
    expect(gapBetween(h1, h2)).toBe(7);
  });
});

describe("splitRows", () => {
  it("pairs deletions with the additions that replaced them", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old first
-old second
+new first
+new second
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.left?.text).toBe("old first");
    expect(rows[0]!.right?.text).toBe("new first");
    expect(rows[1]!.left?.text).toBe("old second");
    expect(rows[1]!.right?.text).toBe("new second");
  });

  it("pads uneven runs when more deletions than additions", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,1 @@
-old first
-old second
-old third
+new only
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.left?.text).toBe("old first");
    expect(rows[0]!.right?.text).toBe("new only");
    expect(rows[1]!.left?.text).toBe("old second");
    expect(rows[1]!.right).toBeUndefined();
    expect(rows[2]!.left?.text).toBe("old third");
    expect(rows[2]!.right).toBeUndefined();
  });

  it("pads uneven runs when more additions than deletions", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,1 +1,3 @@
-old only
+new first
+new second
+new third
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.left?.text).toBe("old only");
    expect(rows[0]!.right?.text).toBe("new first");
    expect(rows[1]!.left).toBeUndefined();
    expect(rows[1]!.right?.text).toBe("new second");
    expect(rows[2]!.left).toBeUndefined();
    expect(rows[2]!.right?.text).toBe("new third");
  });

  it("shows context lines on both sides", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,5 +1,5 @@
 context before
-old line
+new line
 context middle
-old second
+new second
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.left?.text).toBe("context before");
    expect(rows[0]!.right?.text).toBe("context before");
    expect(rows[1]!.left?.text).toBe("old line");
    expect(rows[1]!.right?.text).toBe("new line");
    expect(rows[2]!.left?.text).toBe("context middle");
    expect(rows[2]!.right?.text).toBe("context middle");
    expect(rows[3]!.left?.text).toBe("old second");
    expect(rows[3]!.right?.text).toBe("new second");
  });

  it("handles add-only hunks", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,0 +1,2 @@
+new first
+new second
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.left).toBeUndefined();
    expect(rows[0]!.right?.text).toBe("new first");
    expect(rows[1]!.left).toBeUndefined();
    expect(rows[1]!.right?.text).toBe("new second");
  });

  it("handles delete-only hunks", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,0 @@
-old first
-old second
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.left?.text).toBe("old first");
    expect(rows[0]!.right).toBeUndefined();
    expect(rows[1]!.left?.text).toBe("old second");
    expect(rows[1]!.right).toBeUndefined();
  });

  it("groups consecutive deletions and additions together", () => {
    const patch = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,6 +1,6 @@
 context
-del 1
-del 2
+add 1
+add 2
 context
-del 3
+add 3
`;
    const hunks = parsePatch(patch);
    const rows = splitRows(hunks[0]!);
    expect(rows).toHaveLength(5);
    // First context
    expect(rows[0]!.left?.text).toBe("context");
    expect(rows[0]!.right?.text).toBe("context");
    // First del/add group
    expect(rows[1]!.left?.text).toBe("del 1");
    expect(rows[1]!.right?.text).toBe("add 1");
    expect(rows[2]!.left?.text).toBe("del 2");
    expect(rows[2]!.right?.text).toBe("add 2");
    // Second context
    expect(rows[3]!.left?.text).toBe("context");
    expect(rows[3]!.right?.text).toBe("context");
    // Second del/add group
    expect(rows[4]!.left?.text).toBe("del 3");
    expect(rows[4]!.right?.text).toBe("add 3");
  });
});
