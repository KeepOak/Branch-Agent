import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAgentToolActionDescriptor } from "./agent-tool-metadata.js";
import { createBranchCodingTools } from "./agent-tools.js";
import type { BranchCodingToolsOptions } from "./agent-tools.options.js";
import { createCoreCodingTools } from "./core-coding-tools.js";
import { resolveCoreToolFactoryFamily } from "./core-tool-factory-descriptors.js";
import { DEFAULT_TOOL_ALLOW } from "./sandbox/constants.js";

const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "coding",
);
let root: string;
beforeEach(async () => {
  await fs.mkdir(scratch, { recursive: true });
  root = await fs.mkdtemp(path.join(scratch, "assembled-glob-"));
  await fs.writeFile(path.join(root, "native.ts"), "synthetic");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function assembled(options: Partial<BranchCodingToolsOptions> = {}) {
  return createBranchCodingTools({
    workspaceDir: root,
    cwd: root,
    config: { tools: { profile: "coding", fs: { workspaceOnly: true } } },
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: false,
      includeBranchTools: false,
      includeChannelTools: false,
      includePluginTools: false,
    },
    ...options,
  });
}

describe("actual assembled glob coding caller", () => {
  it("runs under the coding profile with existing filesystem classification", async () => {
    const tool = assembled({ senderIsOwner: false }).find(
      (candidate) => candidate.name === "glob",
    )!;
    expect(tool).toBeDefined();
    expect(getAgentToolActionDescriptor(tool)).toEqual({ family: "data", operation: "filesystem" });
    expect(resolveCoreToolFactoryFamily("glob")).toBe("base-coding");
    expect(DEFAULT_TOOL_ALLOW).toContain("glob");
    expect((await tool.execute("native", { pattern: "*.ts" })).details).toEqual({
      files: [path.join(root, "native.ts")],
      truncated: false,
    });
  });

  it("selects the real factory from an explicit glob-only allowlist", () => {
    expect(
      assembled({ toolConstructionPlan: undefined, config: { tools: { allow: ["glob"] } } }).map(
        (tool) => tool.name,
      ),
    ).toEqual(["glob"]);
  });

  it("returns canonical selected roots through the assembled workspace guard", async () => {
    await fs.mkdir(path.join(root, "target"));
    await fs.writeFile(path.join(root, "target", "child.ts"), "synthetic");
    await fs.symlink(path.join(root, "target"), path.join(root, "alias"), "dir");
    const tool = assembled().find((candidate) => candidate.name === "glob")!;
    const result = await tool.execute("assembled-root-link", { path: "alias", pattern: "*.ts" });
    expect(result.details).toEqual({
      files: [path.join(await fs.realpath(path.join(root, "target")), "child.ts")],
      truncated: false,
    });
  });

  it("keeps glob available in read-only coding scopes", async () => {
    const tools = createCoreCodingTools({
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
    });
    expect(tools.some((tool) => tool.name === "write")).toBe(false);
    const tool = tools.find((candidate) => candidate.name === "glob")!;
    expect((await tool.execute("readonly", { pattern: "*.ts" })).details).toMatchObject({
      truncated: false,
    });
  });

  it("obeys explicit deny, disabled base scopes and memory-flush projection", () => {
    expect(
      assembled({ config: { tools: { profile: "coding", deny: ["glob"] } } }).some(
        (tool) => tool.name === "glob",
      ),
    ).toBe(false);
    expect(
      assembled({
        toolConstructionPlan: {
          includeBaseCodingTools: false,
          includeShellTools: false,
          includeBranchTools: false,
          includeChannelTools: false,
          includePluginTools: false,
        },
      }).some((tool) => tool.name === "glob"),
    ).toBe(false);
    expect(
      assembled({ trigger: "memory", memoryFlushWritePath: "memory/synthetic.md" }).some(
        (tool) => tool.name === "glob",
      ),
    ).toBe(false);
  });
});
