import { describe, expect, it } from "vitest";
import {
  formatPreservedWorktreeConfirmation,
  formatPreservedWorktreesNotice,
} from "./worktree-preservation.ts";

describe("preserved session worktree presentation", () => {
  it("formats single and batch guidance with the preserved reasons", () => {
    const busy = {
      id: "wt-busy",
      branch: "branch/busy-task",
      path: "/worktrees/busy-task",
      reason: "busy" as const,
    };
    const snapshot = {
      id: "wt-snapshot",
      branch: "branch/snapshot-task",
      path: "/worktrees/snapshot-task",
      reason: "snapshot-failed" as const,
    };

    expect(formatPreservedWorktreeConfirmation(snapshot)).toBe(
      "Session needs attention: branch/snapshot-task — Branch Agent could not create a safety snapshot. Remove?",
    );
    expect(formatPreservedWorktreesNotice([busy, snapshot])).toBe(
      "Managed Worktrees:\nbranch/busy-task — live run or cleanup active\nbranch/snapshot-task — Branch Agent could not create a safety snapshot",
    );
  });
});
