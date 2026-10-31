import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreCodingTools } from "./core-coding-tools.js";

type CoreOptions = Parameters<typeof createCoreCodingTools>[0];

const LINE_COUNT = 3412;
const PARTIAL_REFUSAL = "You only read part of this file. Read the rest or use an edit instead.";
const UNREAD_SHRINK_REFUSAL =
  "You have not read this file, and this write would shrink it. Read it first, or use an edit.";

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "branch-read-guard-")));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function lineText(index: number): string {
  return `L${String(index).padStart(4, "0")} ${"x".repeat(30)}`;
}

function bigFileContent(): string {
  return Array.from({ length: LINE_COUNT }, (_, index) => lineText(index + 1)).join("\n") + "\n";
}

function toolSet(extra?: { modelContextWindowTokens?: number }) {
  return createCoreCodingTools({
    codingRoot: root,
    containmentRoot: root,
    includeBaseCodingTools: true,
    shellTools: "disabled",
    workspaceOnly: true,
    readOnly: false,
    applyPatchEnabled: false,
    applyPatchWorkspaceOnly: true,
    execDefaults: {},
    processDefaults: {},
    ...extra,
  } as unknown as CoreOptions);
}

function tool(tools: ReturnType<typeof toolSet>, name: string) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`missing tool ${name}`);
  }
  return found;
}

function textOf(result: { content: unknown }): string {
  const blocks = result.content as { type: string; text?: string }[];
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

describe("read truncation marker", () => {
  it("marks a large file as truncated in-band and in structured details", async () => {
    const filePath = path.join(root, "big.txt");
    const content = bigFileContent();
    await fs.writeFile(filePath, content);

    const result = await tool(toolSet(), "read").execute("read-big", { path: "big.txt" });

    const text = textOf(result);
    expect(text).toContain("File truncated");
    expect(text).toContain(`of ${LINE_COUNT}`);
    expect(result.details).toMatchObject({
      kind: "truncated",
      truncation: {
        truncated: true,
        totalLines: LINE_COUNT,
        totalBytes: Buffer.byteLength(content, "utf8"),
      },
    });
  });

  it("marks a token-budget cutoff with the line range, flag, and file size", async () => {
    // Under the 32KB byte floor, over a small context's tool-result budget.
    const filePath = path.join(root, "budget.txt");
    const content = Array.from({ length: 400 }, () => "y".repeat(40)).join("\n") + "\n";
    await fs.writeFile(filePath, content);

    const result = await tool(toolSet({ modelContextWindowTokens: 4_000 }), "read").execute(
      "read-budget",
      { path: "budget.txt" },
    );

    const text = textOf(result);
    expect(text).toContain("File truncated");
    expect(text).toContain("of 400");
    expect(result.details).toMatchObject({
      kind: "truncated",
      truncation: {
        truncated: true,
        totalLines: 400,
        totalBytes: Buffer.byteLength(content, "utf8"),
      },
    });
  });
});

describe("whole-file write guard", () => {
  it("refuses an overwrite after a partial read", async () => {
    const filePath = path.join(root, "big.txt");
    const original = bigFileContent();
    await fs.writeFile(filePath, original);
    const tools = toolSet();
    await tool(tools, "read").execute("read-partial", { path: "big.txt" });

    await expect(
      tool(tools, "write").execute("write-after-partial", {
        path: "big.txt",
        content: "replacement\n",
      }),
    ).rejects.toThrow(PARTIAL_REFUSAL);
    expect(await fs.readFile(filePath, "utf8")).toBe(original);
  });

  it("allows an overwrite after a full read", async () => {
    const filePath = path.join(root, "small.txt");
    await fs.writeFile(filePath, "one\ntwo\nthree\n");
    const tools = toolSet();
    await tool(tools, "read").execute("read-full", { path: "small.txt" });

    await tool(tools, "write").execute("write-after-full", {
      path: "small.txt",
      content: "replacement\n",
    });

    expect(await fs.readFile(filePath, "utf8")).toBe("replacement\n");
  });

  it("allows an overwrite once paging reaches end of file", async () => {
    const filePath = path.join(root, "big.txt");
    await fs.writeFile(filePath, bigFileContent());
    const tools = toolSet();
    let details = (
      await tool(tools, "read").execute("read-page-0", { path: "big.txt" })
    ).details as { kind: string; continuation?: { offset: number } };
    let page = 1;
    while (details.kind === "truncated" && page < 20) {
      details = (
        await tool(tools, "read").execute(`read-page-${page}`, {
          path: "big.txt",
          offset: details.continuation!.offset,
        })
      ).details as typeof details;
      page += 1;
    }
    expect(details.kind).toBe("text");

    await tool(tools, "write").execute("write-after-paging", {
      path: "big.txt",
      content: "replacement\n",
    });

    expect(await fs.readFile(filePath, "utf8")).toBe("replacement\n");
  });

  it("refuses to shrink a file the agent never read", async () => {
    const filePath = path.join(root, "unread.txt");
    const original = "alpha\nbeta\ngamma\n";
    await fs.writeFile(filePath, original);

    await expect(
      tool(toolSet(), "write").execute("write-unread", { path: "unread.txt", content: "x\n" }),
    ).rejects.toThrow(UNREAD_SHRINK_REFUSAL);
    expect(await fs.readFile(filePath, "utf8")).toBe(original);
  });
});

describe("targeted edit after a partial read", () => {
  it("still applies an edit", async () => {
    const filePath = path.join(root, "big.txt");
    await fs.writeFile(filePath, bigFileContent());
    const tools = toolSet();
    await tool(tools, "read").execute("read-partial-edit", { path: "big.txt" });

    await tool(tools, "edit").execute("edit-after-partial", {
      path: "big.txt",
      edits: [{ oldText: lineText(1), newText: "L0001 changed" }],
    });

    expect((await fs.readFile(filePath, "utf8")).startsWith("L0001 changed\n")).toBe(true);
  });
});
