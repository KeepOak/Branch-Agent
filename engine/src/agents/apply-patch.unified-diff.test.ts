import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApplyPatchTool, extractApplyPatchPaths } from "./apply-patch.js";

const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-batch-20261003",
  "coding",
);

async function withWorkspace(fn: (root: string) => Promise<void>) {
  await fs.mkdir(scratch, { recursive: true });
  const scratchRoot = await fs.realpath(scratch);
  const root = await fs.realpath(await fs.mkdtemp(path.join(scratchRoot, "unified-")));
  try {
    await fn(root);
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(scratchRoot) + path.sep))
      throw new Error("Invalid scratch cleanup path");
    await fs.rm(root, { recursive: true, force: true });
  }
}

function diff(before: string, after: string, oldPath = "a/file.txt", newPath = "b/file.txt") {
  return `--- ${oldPath}\n+++ ${newPath}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}

describe("apply_patch unified diff native caller", () => {
  it("keeps headered creation authoritative over the fallback path", async () => {
    await withWorkspace(async (root) => {
      const input = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new\n";
      const result = await createApplyPatchTool({ cwd: root }).execute("create-with-path", {
        input,
        path: "new.txt",
      });
      expect(result.details?.summary.added).toEqual(["new.txt"]);
      expect(await fs.readFile(path.join(root, "new.txt"), "utf8")).toBe("new\n");
    });
  });

  it("keeps headered deletion authoritative over the fallback path", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "old.txt"), "old\n");
      const input = "--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
      const result = await createApplyPatchTool({ cwd: root }).execute("delete-with-path", {
        input,
        path: "old.txt",
      });
      expect(result.details?.summary.deleted).toEqual(["old.txt"]);
      await expect(fs.stat(path.join(root, "old.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("keeps headered rename authoritative over the fallback path", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "old.txt"), "old\n");
      const input = "--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-old\n+new\n";
      const result = await createApplyPatchTool({ cwd: root }).execute("rename-with-path", {
        input,
        path: "old.txt",
      });
      expect(result.details?.summary.modified).toEqual(["new.txt"]);
      expect(await fs.readFile(path.join(root, "new.txt"), "utf8")).toBe("new\n");
      await expect(fs.stat(path.join(root, "old.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("applies header-like payload across multiple hunks without changing target paths", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "-- old\nsecond\n");
      const input =
        "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n--- old\n+++ new\n@@ -2 +2 @@\n-second\n+changed\n";
      const result = await createApplyPatchTool({ cwd: root }).execute("payload", { input });
      expect(result.details?.summary.modified).toEqual(["file.txt"]);
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("++ new\nchanged\n");
    });
  });

  it("deletes a complete BOM-prefixed file while refusing partial deletion", async () => {
    await withWorkspace(async (root) => {
      const target = path.join(root, "file.txt");
      const tool = createApplyPatchTool({ cwd: root });
      const input = "--- a/file.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-created\n";
      await fs.writeFile(target, "\uFEFFcreated\nuntouched\n");
      await expect(tool.execute("partial-bom", { input })).rejects.toThrow(/complete file/);
      expect(await fs.readFile(target, "utf8")).toBe("\uFEFFcreated\nuntouched\n");
      await fs.writeFile(target, "\uFEFFcreated\n");
      expect((await tool.execute("delete-bom", { input })).details?.summary.deleted).toEqual([
        "file.txt",
      ]);
      await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("extracts source and destination context paths for both patch formats", () => {
    expect(
      extractApplyPatchPaths(diff("before", "after", "a/source.txt", "b/destination.txt")),
    ).toEqual(["source.txt", "destination.txt"]);
    expect(extractApplyPatchPaths("@@ -1 +1 @@\n-before\n+after", "target.txt")).toEqual([
      "target.txt",
    ]);
    expect(
      extractApplyPatchPaths(
        "*** Begin Patch\n*** Update File: source.txt\n*** Move to: destination.txt\n@@\n-before\n+after\n*** Add File: added.txt\n+new\n*** Delete File: deleted.txt\n*** End Patch",
      ),
    ).toEqual(["source.txt", "destination.txt", "added.txt", "deleted.txt"]);
  });

  it("applies Continue replacements through the production tool with CRLF and BOM intact", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "\uFEFFfirst\r\n  second\r\nthird\r\n");
      const tool = createApplyPatchTool({ cwd: root });
      const result = await tool.execute("unified", {
        input:
          "--- a/file.txt\n+++ b/file.txt\n@@ -30,3 +30,3 @@\n first\n- second\n+  replacement\n third\n",
      });
      expect(result.details?.summary.modified).toEqual(["file.txt"]);
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe(
        "\uFEFFfirst\r\n  replacement\r\nthird\r\n",
      );
    });
  });

  it("accepts headerless diffs with an explicit path", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "before\n");
      await createApplyPatchTool({ cwd: root }).execute("unified", {
        input: "@@ -1 +1 @@\n-before\n+after",
        path: "file.txt",
      });
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("after\n");
    });
  });

  it("applies several git file sections and preserves header-like content lines", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "-- content\n");
      await fs.writeFile(path.join(root, "second.txt"), "before\n");
      const input =
        diff("-- content", "++ content") +
        "diff --git a/second.txt b/second.txt\nindex 123..456 100644\n" +
        diff("before", "after", "a/second.txt", "b/second.txt");
      await createApplyPatchTool({ cwd: root }).execute("multi", { input });
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("++ content\n");
      expect(await fs.readFile(path.join(root, "second.txt"), "utf8")).toBe("after\n");
    });
  });

  it("creates files exclusively and deletes only matching complete files", async () => {
    await withWorkspace(async (root) => {
      const tool = createApplyPatchTool({ cwd: root });
      const input = "--- /dev/null\n+++ b/nested/new.txt\n@@ -0,0 +1 @@\n+created\n";
      expect((await tool.execute("create", { input })).details?.summary.added).toEqual([
        path.join("nested", "new.txt"),
      ]);
      await expect(tool.execute("collision", { input })).rejects.toThrow(/already exists/);
      expect(await fs.readFile(path.join(root, "nested/new.txt"), "utf8")).toBe("created\n");
      const deletion = "--- a/nested/new.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-created\n";
      expect((await tool.execute("delete", { input: deletion })).details?.summary.deleted).toEqual([
        path.join("nested", "new.txt"),
      ]);
      await expect(fs.stat(path.join(root, "nested/new.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("refuses incomplete or mismatched deletion without removing the file", async () => {
    await withWorkspace(async (root) => {
      const target = path.join(root, "file.txt");
      await fs.writeFile(target, "before\nuntouched\n");
      const tool = createApplyPatchTool({ cwd: root });
      await expect(
        tool.execute("partial", {
          input: "--- a/file.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-before\n",
        }),
      ).rejects.toThrow(/complete file/);
      await expect(
        tool.execute("mismatch", {
          input: "--- a/file.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-wrong\n",
        }),
      ).rejects.toThrow(/cleanly/);
      expect(await fs.readFile(target, "utf8")).toBe("before\nuntouched\n");
    });
  });

  it("renames through exclusive creation without overwriting an existing destination", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "before\n");
      await fs.writeFile(path.join(root, "taken.txt"), "keep\n");
      const tool = createApplyPatchTool({ cwd: root });
      await expect(
        tool.execute("collision", { input: diff("before", "after", "a/file.txt", "b/taken.txt") }),
      ).rejects.toThrow(/already exists/);
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("before\n");
      expect(await fs.readFile(path.join(root, "taken.txt"), "utf8")).toBe("keep\n");
      await tool.execute("rename", {
        input: diff("before", "after", "a/file.txt", "b/renamed.txt"),
      });
      expect(await fs.readFile(path.join(root, "renamed.txt"), "utf8")).toBe("after\n");
      await expect(fs.stat(path.join(root, "file.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it.each(["../escape.txt", "/tmp/escape.txt", "nested/../../escape.txt"])(
    "retains workspace containment for %s",
    async (escape) => {
      await withWorkspace(async (root) => {
        const input = `--- /dev/null\n+++ ${escape}\n@@ -0,0 +1 @@\n+escape\n`;
        await expect(
          createApplyPatchTool({ cwd: root }).execute("escape", { input }),
        ).rejects.toThrow(/escapes sandbox root/);
      });
    },
  );

  it("rejects ambiguous fallback hunks and uses valid line numbers to disambiguate", async () => {
    await withWorkspace(async (root) => {
      const target = path.join(root, "file.txt");
      await fs.writeFile(target, "before\nbefore\n");
      const tool = createApplyPatchTool({ cwd: root });
      await expect(
        tool.execute("ambiguous", { input: diff("before", "after").replace("-1 +1", "-99 +99") }),
      ).rejects.toThrow(/ambiguous/);
      expect(await fs.readFile(target, "utf8")).toBe("before\nbefore\n");
      await tool.execute("exact-position", {
        input: diff("before", "after").replace("-1 +1", "-2 +2"),
      });
      expect(await fs.readFile(target, "utf8")).toBe("before\nafter\n");
    });
  });

  it("inserts without context at the requested position", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "first\nlast\n");
      await createApplyPatchTool({ cwd: root }).execute("insert", {
        path: "file.txt",
        input: "@@ -1,0 +2 @@\n+middle\n",
      });
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("first\nmiddle\nlast\n");
    });
  });

  it("honors the new-file missing-final-newline marker", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "before\n");
      const input = diff("before", "after") + "\\ No newline at end of file\n";
      await createApplyPatchTool({ cwd: root }).execute("no-newline", { input });
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("after");
    });
  });

  it("adds a final newline when only the old side had no newline", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "before");
      const input =
        "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-before\n\\ No newline at end of file\n+after\n";
      await createApplyPatchTool({ cwd: root }).execute("add-newline", { input });
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("after\n");
    });
  });

  it("keeps pre-aborted calls from touching the target", async () => {
    await withWorkspace(async (root) => {
      await fs.writeFile(path.join(root, "file.txt"), "before\n");
      await expect(
        createApplyPatchTool({ cwd: root }).execute(
          "abort",
          { input: diff("before", "after") },
          AbortSignal.abort(),
        ),
      ).rejects.toThrow(/Aborted/);
      expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("before\n");
    });
  });
});
