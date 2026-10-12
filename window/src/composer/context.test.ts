import { describe, expect, it } from "vitest";
import { diffContext, folderContext } from "./context";

describe("@ Add as context", () => {
  it("@diff turns sessions.diff's uncommitted patches into one pasted text", () => {
    const got = diffContext("diff", { sessionKey: "k", files: [{ path: "a.ts", status: "modified", additions: 2, deletions: 1, patch: "--- a/a.ts\n+++ b/a.ts" }], additions: 2, deletions: 1 });
    expect(got).toEqual({ text: "Changes not yet saved: 1 file, +2 −1\n\n--- a/a.ts\n+++ b/a.ts" });
  });
  it("@git lists the branch's commits, newest first, with short ids", () => {
    const got = diffContext("git", { sessionKey: "k", branch: "fix-export", baseRef: "main", files: [], additions: 0, deletions: 0, commits: [{ sha: "3f2a9c1d00", subject: "Fix the export" }] });
    expect(got).toEqual({ text: "Recent commits on fix-export, newest first:\n3f2a9c1 Fix the export" });
  });
  it("says why there is nothing to add", () => {
    expect(diffContext("diff", { sessionKey: "k", files: [], additions: 0, deletions: 0, unavailableReason: "not_git" })).toHaveProperty("problem");
    expect(diffContext("diff", { sessionKey: "k", files: [], additions: 0, deletions: 0 })).toEqual({ problem: "Nothing is changed and unsaved in this conversation's folder." });
  });
  it("@folder lists the picked folder's files", () => {
    expect(folderContext(["notes/b.md", "notes/a.md"])).toBe("What's in notes (2 files):\nnotes/a.md\nnotes/b.md");
    expect(folderContext([])).toBeNull();
  });
});
