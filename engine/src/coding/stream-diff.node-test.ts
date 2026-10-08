// Source fixtures: continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470 core/diff/streamDiff.vitest.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { distance } from "./continue-levenshtein.ts";
import { diffLines, matchLine } from "./stream-diff.ts";
const expect = (value: unknown) => ({
  toEqual: (expected: unknown) => assert.deepEqual(value, expected),
});
test("no changes", async () => {
  const oldLines = ["first item", "second arg", "third param"];
  const newLines = ["first item", "second arg", "third param"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "same", line: "second arg" },
    { type: "same", line: "third param" },
  ]);
});

test("add new line", async () => {
  const oldLines = ["first item", "second arg"];
  const newLines = ["first item", "second arg", "third param"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "same", line: "second arg" },
    { type: "new", line: "third param" },
  ]);
});

test("remove line", async () => {
  const oldLines = ["first item", "second arg", "third param"];
  const newLines = ["first item", "third param"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "old", line: "second arg" },
    { type: "same", line: "third param" },
  ]);
});

test("modify line", async () => {
  const oldLines = ["first item", "second arg", "third param"];
  const newLines = ["first item", "modified second arg", "third param"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "old", line: "second arg" },
    { type: "new", line: "modified second arg" },
    { type: "same", line: "third param" },
  ]);
});

test("add multiple lines", async () => {
  const oldLines = ["first item", "fourth val"];
  const newLines = ["first item", "second arg", "third param", "fourth val"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "new", line: "second arg" },
    { type: "new", line: "third param" },
    { type: "same", line: "fourth val" },
  ]);
});

test("remove multiple lines", async () => {
  const oldLines = ["first item", "second arg", "third param", "fourth val"];
  const newLines = ["first item", "fourth val"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "same", line: "first item" },
    { type: "old", line: "second arg" },
    { type: "old", line: "third param" },
    { type: "same", line: "fourth val" },
  ]);
});

test("empty old lines", async () => {
  const oldLines: string[] = [];
  const newLines = ["first item", "second arg"];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "new", line: "first item" },
    { type: "new", line: "second arg" },
  ]);
});

test("empty new lines", async () => {
  const oldLines = ["first item", "second arg"];
  const newLines: string[] = [];

  const streamDiffs = [...diffLines(oldLines, newLines)];

  expect(streamDiffs).toEqual([
    { type: "old", line: "first item" },
    { type: "old", line: "second arg" },
  ]);
});

test("long near-identical context retains the source's distant-match threshold", () => {
  const prefix = "p".repeat(20_000);
  const oldLines = [...Array.from({ length: 8 }, (_, i) => `anchor ${i}`), `${prefix}A`];
  const newLine = `${prefix}B`;
  const result = [...diffLines(oldLines, [newLine])];
  assert.equal(result.filter((line) => line.type === "new").length, 1);
  assert.equal(result.filter((line) => line.type === "old").length, 9);
  assert.equal(result.find((line) => line.type === "new")?.line, newLine);
  assert.equal(result.at(-1)?.line, oldLines.at(-1));
});

test("donor distance counts UTF-16 units and preserves wide blocks", () => {
  assert.equal(distance("😀", ""), 2);
  assert.equal(distance("😀", "😁"), 1);
  assert.equal(distance("e\u0301", "é"), 2);
  assert.equal(distance("😀".repeat(35), "😀".repeat(35) + "x"), 1);
});

test("Continue's exact 0.48 distance threshold is retained", () => {
  const oldLine = "a".repeat(25);
  assert.equal(matchLine("a".repeat(13) + "b".repeat(12), [oldLine]).matchIndex, 0);
  assert.equal(matchLine("a".repeat(12) + "b".repeat(13), [oldLine]).matchIndex, -1);
});
