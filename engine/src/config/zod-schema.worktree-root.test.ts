import path from "node:path";
import { expect, it } from "vitest";
import { BranchSchema } from "./zod-schema.js";

it.each([
  path.resolve("worktrees"),
  "~/worktrees",
  "~",
  ...(path.sep === "\\" ? ["~\\worktrees"] : []),
])("accepts absolute or home-relative worktreeRoot %s", (worktreeRoot) => {
  expect(BranchSchema.parse({ worktreeRoot }).worktreeRoot).toBe(worktreeRoot);
});

it("rejects a relative worktreeRoot", () => {
  expect(BranchSchema.safeParse({ worktreeRoot: "worktrees" }).success).toBe(false);
});

it.each([1, 4096, 100_000])("accepts a positive managed-worktree cap %s", (worktreeMaxCount) => {
  expect(BranchSchema.parse({ worktreeMaxCount }).worktreeMaxCount).toBe(worktreeMaxCount);
});

it.each([0, -1, 1.5, "4096", null])(
  "rejects an invalid managed-worktree cap %s",
  (worktreeMaxCount) => {
    expect(BranchSchema.safeParse({ worktreeMaxCount }).success).toBe(false);
  },
);
