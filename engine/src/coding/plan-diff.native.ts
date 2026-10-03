// Seven assertions/cases ported from pinned mastra plan-diff.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePlanDiff, shouldShowDiff } from "./plan-diff.js";

test("marks only the changed line, not everything after an insertion", () => {
  const entries = generatePlanDiff("a\nb\nc", "a\nx\nb\nc");
  assert.deepEqual(entries.filter(e => e.type === "added").map(e => e.text), ["x"]);
  assert.equal(entries.filter(e => e.type === "removed").length, 0);
  assert.deepEqual(entries.filter(e => e.type === "context").map(e => e.text), ["a", "b", "c"]);
});
test("captures removals", () => {
  const entries = generatePlanDiff("a\nb\nc", "a\nc");
  assert.deepEqual(entries.filter(e => e.type === "removed").map(e => e.text), ["b"]);
});
test("normalizes CRLF and LF line endings before diffing", () => {
  assert.deepEqual(generatePlanDiff("Step 1\r\nStep 2\r\nStep 3", "Step 1\nStep 2 updated\nStep 3"), [
    { type: "context", text: "Step 1" },
    { type: "removed", text: "Step 2" },
    { type: "added", text: "Step 2 updated" },
    { type: "context", text: "Step 3" },
  ]);
});
test("shows a diff for a small targeted edit", () => {
  const previous = ["Build the feature", "Run tests", "Update docs"].join("\n");
  const next = ["Build the feature", "Add tests", "Update docs"].join("\n");
  assert.equal(shouldShowDiff(previous, next), true);
});
test("shows a diff for an inserted line (LCS keeps the rest as context)", () => {
  const previous = ["Step 1", "Step 2", "Step 3"].join("\n");
  const next = ["Step 1", "Step 1.5", "Step 2", "Step 3"].join("\n");
  assert.equal(shouldShowDiff(previous, next), true);
});
test("falls back to the full plan when most of the new plan changed", () => {
  const previous = ["Old line 1", "Old line 2", "Old line 3", "Keep"].join("\n");
  const next = ["New line 1", "New line 2", "New line 3", "Keep"].join("\n");
  assert.equal(shouldShowDiff(previous, next), false);
});
test("returns false when there is no previous plan or no change", () => {
  assert.equal(shouldShowDiff("", "New plan"), false);
  assert.equal(shouldShowDiff("Same plan", "Same plan"), false);
});
