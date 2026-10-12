import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGlobTool } from "./glob-tool.js";

const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "coding",
);
let root: string;
beforeEach(async () => {
  await fs.mkdir(scratch, { recursive: true });
  // Canonical roots keep expectations stable where temp paths are aliases (macOS /var, Windows 8.3).
  root = await fs.realpath(await fs.mkdtemp(path.join(scratch, "native-glob-")));
  await fs.writeFile(path.join(root, "file.ts"), "synthetic");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("native glob tool", () => {
  it("returns typed actual paths without writing or activating a visible callback", async () => {
    const tool = createGlobTool(root, { root });
    const result = await tool.execute("glob", { pattern: "*.ts" });
    expect(result.details).toEqual({ files: [path.join(root, "file.ts")], truncated: false });
    expect(Value.Check(tool.outputSchema!, result.details)).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: `1 files\n${path.join(root, "file.ts")}` },
    ]);
    expect(await fs.readdir(root)).toEqual(["file.ts"]);
  });

  it("uses default cwd and literal @ directory path semantics", async () => {
    await fs.mkdir(path.join(root, "@literal"));
    await fs.writeFile(path.join(root, "@literal", "child.ts"), "synthetic");
    const result = await createGlobTool(root, { root }).execute("literal", {
      path: "@@literal",
      pattern: "*.ts",
    });
    expect(result.details?.files).toEqual([path.join(root, "@literal", "child.ts")]);
    const singlePrefix = await createGlobTool(root, { root }).execute("literal-one-prefix", {
      path: "@literal",
      pattern: "*.ts",
    });
    expect(singlePrefix.details?.files).toEqual([path.join(root, "@literal", "child.ts")]);
  });

  it("returns all matches without imposing the listing tool page cap", async () => {
    await Promise.all(
      Array.from({ length: 520 }, (_, index) =>
        fs.writeFile(path.join(root, `${index}.ts`), "synthetic"),
      ),
    );
    const result = await createGlobTool(root, { root }).execute("uncapped", { pattern: "*.ts" });
    expect(result.details?.files).toHaveLength(521);
    expect(result.details?.truncated).toBe(false);
  });

  it("uses the canonical root for an explicitly selected in-root directory link", async () => {
    await fs.mkdir(path.join(root, "target"));
    await fs.writeFile(path.join(root, "target", "child.ts"), "synthetic");
    await fs.symlink(path.join(root, "target"), path.join(root, "alias"), "dir");
    const result = await createGlobTool(root, { root }).execute("root-link", {
      path: "alias",
      pattern: "*.ts",
    });
    expect(result.details).toEqual({
      files: [path.join(await fs.realpath(path.join(root, "target")), "child.ts")],
      truncated: false,
    });
  });

  it("preserves a best-effort empty result for a missing validated search root", async () => {
    const result = await createGlobTool(root, { root }).execute("missing-root", {
      path: "missing",
      pattern: "*.ts",
    });
    expect(result.details).toEqual({ files: [], truncated: false });
  });

  it.each(["../*.ts", "C:\\escape\\*.ts", "\0*.ts"])("rejects pattern %s", async (pattern) => {
    await expect(createGlobTool(root, { root }).execute("invalid", { pattern })).rejects.toThrow(
      /glob pattern/,
    );
  });

  it("rejects a root escaping the existing workspace boundary", async () => {
    await expect(
      createGlobTool(root, { root }).execute("outside", { path: "..", pattern: "*.ts" }),
    ).rejects.toThrow(/escapes|outside/);
  });

  it("does not swallow cancellation during a best-effort directory read", async () => {
    const controller = new AbortController();
    const tool = createGlobTool(root, {
      operations: {
        validatePath: async () => {},
        readDirectory: async () => {
          controller.abort(new Error("cancel glob"));
          throw new Error("unreadable");
        },
        stat: async () => null,
      },
    });
    await expect(tool.execute("cancel", { pattern: "**/*" }, controller.signal)).rejects.toThrow(
      "cancel glob",
    );
  });
});
