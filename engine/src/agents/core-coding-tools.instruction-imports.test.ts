import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { createCoreCodingTools } from "./core-coding-tools.js";
import type { InstructionImportFormat } from "./instruction-imports.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.types.js";
import { createSandboxTestContext } from "./sandbox/test-fixtures.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("native file tools deliver Gemini instruction imports", () => {
  let root: string;
  beforeEach(async () => {
    root = tempDirs.make("branch-instruction-imports-");
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "sibling"), { recursive: true });
    await fs.writeFile(path.join(root, "GEMINI.md"), "Root instructions @./docs/shared.md");
    await fs.writeFile(
      path.join(root, "src", "GEMINI.md"),
      "Local instructions @../docs/local.txt",
    );
    await fs.writeFile(path.join(root, "sibling", "GEMINI.md"), "Sibling instructions");
    await fs.writeFile(path.join(root, "docs", "shared.md"), "Shared imported instructions");
    await fs.writeFile(path.join(root, "docs", "local.txt"), "Imported text instructions");
    await fs.writeFile(path.join(root, "src", "client.ts"), "export const client = true;\n");
  });

  function tools(format?: InstructionImportFormat, bridge?: SandboxFsBridge) {
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
      projectInstructionImportFormat: format,
      sandbox: bridge
        ? createSandboxTestContext({
            overrides: {
              workspaceDir: root,
              agentWorkspaceDir: root,
              fsBridge: bridge,
            },
          })
        : undefined,
    });
  }

  function text(result: Awaited<ReturnType<ReturnType<typeof tools>[number]["execute"]>>) {
    return result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  it("expands ancestor imports in real read results and refreshes changed imported files", async () => {
    const read = tools().find((tool) => tool.name === "read")!;
    const input = { path: "src/client.ts" };
    const first = text(await read.execute("first", input));
    expect(first).toContain("export const client = true;");
    expect(first).toContain("<!-- Imported from: ./docs/shared.md -->");
    expect(first).toContain("Shared imported instructions");
    expect(first).toContain("Imported text instructions");
    expect(first).not.toContain("Sibling instructions");
    expect(text(await read.execute("repeat", input))).not.toContain("Project instructions (");
    await fs.writeFile(path.join(root, "docs", "shared.md"), "Changed imported instructions");
    const changed = text(await read.execute("changed", input));
    expect(changed).toContain("Changed imported instructions");
    expect(changed).not.toContain("Imported text instructions");
  });

  it("exposes flat output through the native factory and preserves source import order", async () => {
    await fs.writeFile(
      path.join(root, "GEMINI.md"),
      "@./docs/shared.md @./docs/local.txt @./docs/shared.md",
    );
    const read = tools("flat").find((tool) => tool.name === "read")!;
    const result = text(await read.execute("flat", { path: "src/client.ts" }));
    expect(result).toContain(`--- File: ${path.join(root, "GEMINI.md")} ---`);
    expect(result).toContain("@./docs/shared.md @./docs/local.txt @./docs/shared.md");
    expect(result.indexOf("Shared imported instructions")).toBeLessThan(
      result.indexOf("Imported text instructions"),
    );
    expect(result.match(/Shared imported instructions/g)).toHaveLength(1);
    expect(result).not.toContain("<!-- Imported from:");
  });

  it("keeps code literals, cycle diagnostics, missing files and rejected paths in successful reads", async () => {
    await fs.writeFile(
      path.join(root, "GEMINI.md"),
      [
        "Inline `@./docs/shared.md`",
        "```md\n@./docs/local.txt\n```",
        "@./docs/cycle.md @./missing.md @../outside.md",
      ].join("\n"),
    );
    await fs.writeFile(path.join(root, "docs", "cycle.md"), "Cycle body @./cycle.md");
    const read = tools().find((tool) => tool.name === "read")!;
    const result = text(await read.execute("errors", { path: "src/client.ts" }));
    expect(result).toContain("export const client = true;");
    expect(result).toContain("Inline `@./docs/shared.md`");
    expect(result).toContain("```md\n@./docs/local.txt\n```");
    expect(result).toContain("<!-- File already processed: ./cycle.md -->");
    expect(result).toContain("<!-- Import failed: ./missing.md - File not found:");
    expect(result).toContain("<!-- Import failed: ../outside.md - Path traversal attempt -->");
  });

  it("retains the upstream tree depth default of five through a native write", async () => {
    await fs.writeFile(path.join(root, "GEMINI.md"), "@./docs/level1.md");
    for (let level = 1; level <= 6; level++) {
      await fs.writeFile(
        path.join(root, "docs", `level${level}.md`),
        `Level ${level}\n@./level${level + 1}.md`,
      );
    }
    const write = tools().find((tool) => tool.name === "write")!;
    const result = text(await write.execute("write", { path: "src/new.ts", content: "created\n" }));
    expect(await fs.readFile(path.join(root, "src", "new.ts"), "utf8")).toBe("created\n");
    expect(result).toContain("Level 5\n@./level6.md");
    expect(result).not.toContain("Level 6");
  });

  it("uses the sandbox bridge for imported content and preserves admission failures", async () => {
    const bridge = createHostSandboxFsBridge(root);
    const realRead = bridge.readFile.bind(bridge);
    bridge.readFile = vi.fn(async (options) => {
      if (options.filePath.endsWith("/blocked.md")) {
        throw new Error("physical canonical path outside workspace");
      }
      return realRead(options);
    });
    await fs.writeFile(path.join(root, "GEMINI.md"), "@./docs/shared.md @./docs/blocked.md");
    await fs.writeFile(path.join(root, "docs", "blocked.md"), "Rejected content");
    const read = tools(undefined, bridge).find((tool) => tool.name === "read")!;
    const result = text(await read.execute("sandbox", { path: "/workspace/src/client.ts" }));
    expect(result).toContain("Shared imported instructions");
    expect(result).toContain("physical canonical path outside workspace");
    expect(result).not.toContain("Rejected content");
    expect(bridge.readFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/workspace/docs/shared.md",
        cwd: "/workspace",
      }),
    );
  });

  it("keeps a literal leading at-sign in actual file-tool parameters", async () => {
    await fs.mkdir(path.join(root, "@scope"), { recursive: true });
    await fs.mkdir(path.join(root, "scope"), { recursive: true });
    await fs.writeFile(path.join(root, "@scope", "GEMINI.md"), "Scoped imports @../docs/shared.md");
    await fs.writeFile(path.join(root, "scope", "GEMINI.md"), "Wrong scope");
    await fs.writeFile(path.join(root, "@scope", "file.ts"), "Literal at-sign file");
    await fs.writeFile(path.join(root, "scope", "file.ts"), "Wrong file");
    const read = tools().find((tool) => tool.name === "read")!;
    const result = text(await read.execute("literal", { path: "@scope/file.ts" }));
    expect(result).toContain("Literal at-sign file");
    expect(result).toContain("Scoped imports");
    expect(result).not.toContain("Wrong scope");
    expect(result).not.toContain("Wrong file");
  });
});
