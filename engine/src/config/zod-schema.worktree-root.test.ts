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
