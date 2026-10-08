import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatch } from "diff";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { writeSchema } from "./tool-schemas.js";
import { createWriteTool } from "./write.js";

describe("write tool concurrent Markdown merge", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });
  async function setup(current?: string | Buffer) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-markdown-merge-"));
    dirs.push(dir);
    const file = path.join(dir, "notes.md");
    if (current !== undefined) await fs.writeFile(file, current);
    return { file, tool: createWriteTool(dir) };
  }
  const base = "# First\nold first\n\n# Second\nold second\n";
  const current = base.replace("old first", "current first");
  const proposed = base.replace("old second", "proposed second");
  const merged = current.replace("old second", "proposed second");

  it("exposes optional base_content through the production write schema", () => {
    expect(
      Value.Check(writeSchema, { path: "notes.md", content: proposed, base_content: base }),
    ).toBe(true);
    expect(Value.Check(writeSchema, { path: "notes.md", content: proposed })).toBe(true);
    expect(Value.Check(writeSchema, { path: "notes.md", content: proposed, base_content: 1 })).toBe(
      false,
    );
  });
  it("persists disjoint changes and reports the patch from current to merged content", async () => {
    const { file, tool } = await setup(current);
    const result = await tool.execute("merge", {
      path: file,
      content: proposed,
      base_content: base,
    });
    expect(await fs.readFile(file, "utf8")).toBe(merged);
    expect(result.details?.changed).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: `Successfully wrote ${Buffer.byteLength(merged)} bytes to ${file}` },
    ]);
    if (!result.details || !("patch" in result.details))
      throw new Error("Expected actual patch receipt");
    expect(applyPatch(current, result.details.patch)).toBe(merged);
  });
  it("leaves overlapping edits untouched and reports the base line range", async () => {
    const { file, tool } = await setup(current);
    await expect(
      tool.execute("conflict", {
        path: file,
        content: base.replace("old first", "proposed first"),
        base_content: base,
      }),
    ).rejects.toThrow("lines 2-2");
    expect(await fs.readFile(file, "utf8")).toBe(current);
  });
  it("does not rewrite identical concurrent proposals", async () => {
    const { file, tool } = await setup(proposed);
    const before = await fs.stat(file);
    const result = await tool.execute("same", {
      path: file,
      content: proposed,
      base_content: base,
    });
    expect(result.details).toEqual({ changed: false });
    expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
  });
  it("composes two queued proposals made against the same base", async () => {
    const { file, tool } = await setup(base);
    await Promise.all([
      tool.execute("one", { path: file, content: current, base_content: base }),
      tool.execute("two", { path: file, content: proposed, base_content: base }),
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(merged);
  });
  it("creates a new Markdown file against an empty base", async () => {
    const { file, tool } = await setup();
    const result = await tool.execute("new", { path: file, content: proposed, base_content: "" });
    expect(await fs.readFile(file, "utf8")).toBe(proposed);
    expect(result.details).toMatchObject({ changed: true, created: true });
  });
  it("creates an empty file against an empty base", async () => {
    const { file, tool } = await setup();
    const result = await tool.execute("empty", { path: file, content: "", base_content: "" });
    expect(await fs.readFile(file, "utf8")).toBe("");
    expect(result.details).toMatchObject({ changed: true, created: true });
  });
  it("preserves the ordinary overwrite behavior when no base is supplied", async () => {
    const { file, tool } = await setup(current);
    await tool.execute("overwrite", { path: file, content: proposed });
    expect(await fs.readFile(file, "utf8")).toBe(proposed);
  });
  it("refuses a merge of invalid UTF-8 without replacing bytes", async () => {
    const bytes = Buffer.from([0xff, 0xfe]);
    const { file, tool } = await setup(bytes);
    await expect(
      tool.execute("invalid", { path: file, content: proposed, base_content: base }),
    ).rejects.toThrow("not valid UTF-8");
    expect(await fs.readFile(file)).toEqual(bytes);
  });
  it("does not recreate a concurrently deleted changed document", async () => {
    const { file, tool } = await setup();
    await expect(
      tool.execute("deleted", { path: file, content: proposed, base_content: base }),
    ).rejects.toThrow("concurrent edits conflict");
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
