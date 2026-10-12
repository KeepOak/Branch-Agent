// Ported from JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/lineends_test.go (TestDiffKeepsChangeLinesStartingWithDash) (atlas AGENT-LOOP-0349).
// Upstream has no diff_test.go; the remaining cases are behaviour tests of the ported contract.
import { describe, expect, it } from "vitest";
import { compressDiff } from "./diff.js";

function diffWithContext(change: string): string {
  let b = "diff --git a/doc.md b/doc.md\n--- a/doc.md\n+++ b/doc.md\n@@ -1,30 +1,29 @@\n";
  for (let i = 0; i < 24; i++) {
    b += ` context line ${i} that is unchanged\n`;
  }
  b += change;
  for (let i = 0; i < 24; i++) {
    b += ` trailing context line ${i}\n`;
  }
  return b;
}

describe("diff compressor", () => {
  it("TestDiffKeepsChangeLinesStartingWithDash", () => {
    const out = compressDiff(diffWithContext("----\n"));
    expect(out).toBeDefined();
    expect(out).toContain("----");
  });

  it("keeps headers, changes and two context lines, and collapses the rest", () => {
    const out = compressDiff(diffWithContext("-old value\n+new value\n"))!;
    expect(out).toContain("diff --git a/doc.md b/doc.md");
    expect(out).toContain("@@ -1,30 +1,29 @@");
    expect(out).toContain("-old value\n+new value\n");
    expect(out).toContain(
      " context line 22 that is unchanged\n context line 23 that is unchanged\n-old value",
    );
    expect(out).toContain("… 20 context lines elided (caveman) …");
    expect(out).toContain("… 22 context lines elided (caveman) …");
    expect(out).not.toContain("context line 5 ");
  });

  it("is idempotent", () => {
    const first = compressDiff(diffWithContext("+added\n"))!;
    expect(compressDiff(first)).toBeUndefined();
  });

  it("passes short or fully kept diffs through", () => {
    expect(
      compressDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n"),
    ).toBeUndefined();
  });

  it("uses CRLF for markers when the diff is CRLF", () => {
    const out = compressDiff(diffWithContext("+added\n").replaceAll("\n", "\r\n"))!;
    expect(out).toContain("(caveman) …\r\n");
    expect(out.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
