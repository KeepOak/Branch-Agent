import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { getAgentToolActionDescriptor } from "./agent-tool-metadata.js";
import { createCoreCodingTools } from "./core-coding-tools.js";
import { createSandboxTestContext } from "./sandbox/test-fixtures.js";
import { createHostSandboxFsBridge } from "./test-helpers/host-sandbox-fs-bridge.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("native coding tools deliver touched project instructions", () => {
  let root: string;
  beforeEach(async () => {
    root = tempDirs.make("branch-project-instructions-");
    await fs.mkdir(path.join(root, "src", "auth"), { recursive: true });
    await fs.mkdir(path.join(root, "src", "other"), { recursive: true });
    await fs.mkdir(path.join(root, ".continue", "rules"), { recursive: true });
    await fs.writeFile(path.join(root, "rules.md"), "Root project conventions");
    await fs.writeFile(path.join(root, "src", "auth", "rules.md"), "Auth project conventions");
    await fs.writeFile(path.join(root, "src", "other", "rules.md"), "Other project conventions");
    await fs.writeFile(path.join(root, "src", "auth", "client.ts"), "export const original = 1;\n");
  });

  function tools(deliveryCache?: Map<string, Promise<boolean>>) {
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
      skillInstructionDeliveryCache: deliveryCache,
    });
  }

  function text(result: Awaited<ReturnType<ReturnType<typeof tools>[number]["execute"]>>) {
    return result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }

  it("delivers real read content and scoped rules, refreshes edits, and dedupes repeats", async () => {
    const read = tools().find((tool) => tool.name === "read")!;
    const input = { path: "src/auth/client.ts" };
    const first = await read.execute("first", input);
    expect(text(first)).toContain("export const original = 1;");
    expect(text(first)).toContain("Root project conventions");
    expect(text(first)).toContain("Auth project conventions");
    expect(text(first)).not.toContain("Other project conventions");
    expect(text(await read.execute("second", input))).not.toContain("Project instructions (");
    await fs.writeFile(path.join(root, "src", "auth", "rules.md"), "Updated auth conventions");
    const refreshed = text(await read.execute("third", input));
    expect(refreshed).toContain("Updated auth conventions");
    expect(refreshed).not.toContain("Root project conventions");
    expect(getAgentToolActionDescriptor(read)).toEqual({ family: "data", operation: "filesystem" });
  });

  it("delivers rules through actual write, edit, and directory tools", async () => {
    const write = tools().find((tool) => tool.name === "write")!;
    const written = await write.execute("write", {
      path: "src/auth/new.ts",
      content: "export const value = 2;\n",
    });
    expect(text(written)).toContain("Auth project conventions");
    expect(await fs.readFile(path.join(root, "src", "auth", "new.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    const edit = tools().find((tool) => tool.name === "edit")!;
    const edited = await edit.execute("edit", {
      path: "src/auth/client.ts",
      edits: [{ oldText: "original", newText: "modified" }],
    });
    expect(text(edited)).toContain("Auth project conventions");
    expect(await fs.readFile(path.join(root, "src", "auth", "client.ts"), "utf8")).toContain(
      "modified",
    );
    const ls = tools().find((tool) => tool.name === "ls")!;
    expect(text(await ls.execute("list", { path: "src/auth" }))).toContain(
      "Auth project conventions",
    );
  });

  it("uses full file read content for conditional rules and retries rules that did not match", async () => {
    await fs.writeFile(
      path.join(root, ".continue", "rules", "api.md"),
      "---\nglobs: '**/*.ts'\nregex: 'fetch\\('\n---\nUse API conventions",
    );
    const read = tools().find((tool) => tool.name === "read")!;
    const input = { path: "src/auth/client.ts" };
    expect(text(await read.execute("first", input))).not.toContain("Use API conventions");
    await fs.writeFile(path.join(root, "src", "auth", "client.ts"), "fetch(url);\n");
    expect(text(await read.execute("second", input))).toContain("Use API conventions");
  });

  it("keeps individual malformed rules diagnostic and preserves successful tool results", async () => {
    await fs.writeFile(path.join(root, "src", "rules.md"), "---\nglobs: [\n---\nBroken");
    const read = tools().find((tool) => tool.name === "read")!;
    const result = text(await read.execute("read", { path: "src/auth/client.ts" }));
    expect(result).toContain("export const original = 1;");
    expect(result).toContain("Auth project conventions");
    expect(result).toContain("Could not load project instructions src/rules.md");
  });

  it("reads sandbox instructions through the selected bridge in its container namespace", async () => {
    const bridge = createHostSandboxFsBridge(root);
    bridge.readDirectory = async ({ filePath, cwd }) =>
      (
        await fs.readdir(bridge.resolvePath({ filePath, cwd }).hostPath!, { withFileTypes: true })
      ).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    const sandbox = createSandboxTestContext({
      overrides: {
        workspaceDir: root,
        agentWorkspaceDir: root,
        fsBridge: bridge,
      },
    });
    const read = createCoreCodingTools({
      codingRoot: root,
      containmentRoot: root,
      includeBaseCodingTools: true,
      shellTools: "disabled",
      workspaceOnly: true,
      readOnly: true,
      applyPatchEnabled: false,
      applyPatchWorkspaceOnly: true,
      execDefaults: {},
      processDefaults: {},
      sandbox,
    }).find((tool) => tool.name === "read")!;
    const result = text(
      await read.execute("sandbox-read", { path: "/workspace/src/auth/client.ts" }),
    );
    expect(result).toContain("export const original = 1;");
    expect(result).toContain("Auth project conventions");
    expect(result).not.toContain("Other project conventions");
  });

  it("delivers both touched folders through the native multi-file patch result", async () => {
    const patch = createCoreCodingTools({
      codingRoot: root,
      containmentRoot: root,
      includeBaseCodingTools: false,
      shellTools: "patch-only",
      workspaceOnly: true,
      readOnly: false,
      applyPatchEnabled: true,
      applyPatchWorkspaceOnly: true,
      execDefaults: {},
      processDefaults: {},
    }).find((tool) => tool.name === "apply_patch")!;
    const result = await patch.execute("patch", {
      input: [
        "*** Begin Patch",
        "*** Add File: src/auth/new.ts",
        "+export const auth = 1;",
        "*** Add File: src/other/new.ts",
        "+export const other = 2;",
        "*** End Patch",
      ].join("\n"),
    });
    expect(text(result)).toContain("Auth project conventions");
    expect(text(result)).toContain("Other project conventions");
    expect(text(result).match(/Root project conventions/g)).toHaveLength(1);
    expect(await fs.readFile(path.join(root, "src", "auth", "new.ts"), "utf8")).toContain(
      "auth = 1",
    );
  });

  it("redelivers unchanged instructions when the runner clears context delivery state", async () => {
    const deliveryCache = new Map<string, Promise<boolean>>();
    const read = tools(deliveryCache).find((tool) => tool.name === "read")!;
    const input = { path: "src/auth/client.ts" };
    expect(text(await read.execute("before-compact", input))).toContain("Auth project conventions");
    expect(text(await read.execute("same-context", input))).not.toContain("Project instructions (");
    // The runtime context replacement hook clears this exact shared cache.
    deliveryCache.clear();
    expect(text(await read.execute("after-compact", input))).toContain("Auth project conventions");
  });

  it("keeps successful native read and write results when rule directory listing fails", async () => {
    const bridge = createHostSandboxFsBridge(root);
    bridge.readDirectory = async () => {
      throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
    };
    const sandbox = createSandboxTestContext({
      overrides: {
        workspaceDir: root,
        agentWorkspaceDir: root,
        fsBridge: bridge,
      },
    });
    const codingTools = createCoreCodingTools({
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
      sandbox,
    });
    const read = codingTools.find((tool) => tool.name === "read")!;
    const readText = text(await read.execute("read", { path: "/workspace/src/auth/client.ts" }));
    expect(readText).toContain("export const original = 1;");
    expect(readText).toContain("Could not load project instructions .continue/rules");
    const write = codingTools.find((tool) => tool.name === "write")!;
    const writeText = text(
      await write.execute("write", {
        path: "/workspace/src/auth/new.ts",
        content: "const value = 2;\n",
      }),
    );
    expect(writeText).toContain("Could not load project instructions .continue/rules");
    expect(await fs.readFile(path.join(root, "src", "auth", "new.ts"), "utf8")).toBe(
      "const value = 2;\n",
    );
  });

  it("loads original and destination folder instructions for a native patch rename", async () => {
    const patch = createCoreCodingTools({
      codingRoot: root,
      containmentRoot: root,
      includeBaseCodingTools: false,
      shellTools: "patch-only",
      workspaceOnly: true,
      readOnly: false,
      applyPatchEnabled: true,
      applyPatchWorkspaceOnly: true,
      execDefaults: {},
      processDefaults: {},
    }).find((tool) => tool.name === "apply_patch")!;
    const result = await patch.execute("rename", {
      input: [
        "*** Begin Patch",
        "*** Update File: src/auth/client.ts",
        "*** Move to: src/other/client.ts",
        "@@",
        "-export const original = 1;",
        "+export const moved = 1;",
        "*** End Patch",
      ].join("\n"),
    });
    expect(text(result)).toContain("Auth project conventions");
    expect(text(result)).toContain("Other project conventions");
    expect(await fs.readFile(path.join(root, "src", "other", "client.ts"), "utf8")).toContain(
      "moved = 1",
    );
  });

  it("uses the admitted literal @ directory rather than its mention-shaped sibling", async () => {
    for (const name of ["@scope", "scope"]) {
      await fs.mkdir(path.join(root, name, "src"), { recursive: true });
      await fs.writeFile(path.join(root, name, "src", "client.ts"), `${name} content`);
      await fs.writeFile(path.join(root, name, "rules.md"), `${name} conventions`);
    }
    const read = tools().find((tool) => tool.name === "read")!;
    const result = text(await read.execute("literal", { path: "@scope/src/client.ts" }));
    expect(result).toContain("@scope content");
    expect(result).toContain("@scope conventions");
    expect(result).not.toContain("Project instructions (scope/rules.md)");
    const sibling = text(await read.execute("sibling", { path: "scope/src/client.ts" }));
    expect(sibling).toContain("scope conventions");
    expect(sibling).not.toContain("Project instructions (@scope/rules.md)");
  });
});
