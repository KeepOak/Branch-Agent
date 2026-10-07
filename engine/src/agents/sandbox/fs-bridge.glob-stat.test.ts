import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreCodingTools } from "../core-coding-tools.js";
import { createGlobTool } from "../tools/glob-tool.js";
import {
  createSandbox,
  createSandboxFsBridge,
  dockerExecResult,
  getDockerArg,
  getDockerScript,
  installFsBridgeTestHarness,
  mockedExecDockerRaw,
  mockContainerCanonicalPaths,
} from "./fs-bridge.test-helpers.js";
import type { SandboxFsBridge } from "./fs-bridge.types.js";

const scratch = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "coding",
);
let root: string;
let bridge: SandboxFsBridge;

function installMetadataTransport(workspace: string, agentRoot?: string) {
  const prior = mockedExecDockerRaw.getMockImplementation()!;
  mockedExecDockerRaw.mockImplementation(async (args, options) => {
    const script = getDockerScript(args);
    if (script.includes('stat -c "%F|%s|%y"')) {
      const containerPath = path.posix.join(getDockerArg(args, 1), getDockerArg(args, 2));
      const target =
        agentRoot && (containerPath === "/agent" || containerPath.startsWith("/agent/"))
          ? path.join(agentRoot, path.posix.relative("/agent", containerPath))
          : path.join(workspace, path.posix.relative("/workspace", containerPath));
      const stat = await fs.lstat(target);
      const kind = stat.isFile()
        ? "regular file"
        : stat.isDirectory()
          ? "directory"
          : "symbolic link";
      return dockerExecResult(`${kind}|${stat.size}|${stat.mtimeMs / 1000}`);
    }
    if (script.includes("operation = sys.argv[1]") && getDockerArg(args, 1) === "readdir") {
      const directory = path.join(workspace, getDockerArg(args, 3));
      const entries = (await fs.readdir(directory, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
      return dockerExecResult(JSON.stringify(entries));
    }
    return prior(args, options);
  });
}

describe("guarded sandbox glob metadata", () => {
  installFsBridgeTestHarness();
  beforeEach(async () => {
    await fs.mkdir(scratch, { recursive: true });
    root = await fs.mkdtemp(path.join(scratch, "bridge-glob-"));
    await fs.writeFile(path.join(root, "target.ts"), "synthetic");
    await fs.symlink(path.join(root, "target.ts"), path.join(root, "linked.ts"), "file");
    bridge = createSandboxFsBridge({
      sandbox: createSandbox({ workspaceDir: root, agentWorkspaceDir: root }),
    });
    installMetadataTransport(root);
    mockContainerCanonicalPaths({ "/workspace/linked.ts": "/workspace/target.ts" });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("preserves default no-follow metadata and opts into the guarded canonical target", async () => {
    expect(await bridge.stat({ filePath: "/workspace/linked.ts" })).toMatchObject({
      type: "other",
    });
    expect(
      await bridge.stat({ filePath: "/workspace/linked.ts", followSymlinks: true }),
    ).toMatchObject({ type: "file", size: 9 });
    const statCalls = mockedExecDockerRaw.mock.calls.filter(([args]) =>
      getDockerScript(args).includes('stat -c "%F|%s|%y"'),
    );
    expect(statCalls.map(([args]) => getDockerArg(args, 2))).toEqual(["linked.ts", "target.ts"]);
  });

  it("returns in-root file links through the actual core sandbox caller without host path leakage", async () => {
    const sandbox = createSandbox({ workspaceDir: root, agentWorkspaceDir: root });
    sandbox.fsBridge = bridge;
    const tool = createCoreCodingTools({
      codingRoot: root,
      containmentRoot: root,
      includeBaseCodingTools: true,
      shellTools: "disabled",
      workspaceOnly: true,
      readOnly: true,
      sandbox,
      applyPatchEnabled: false,
      applyPatchWorkspaceOnly: true,
      execDefaults: {},
      processDefaults: {},
    }).find((candidate) => candidate.name === "glob")!;
    const result = await tool.execute("sandbox-glob", { pattern: "*.ts" });
    expect(result.details).toEqual({
      files: ["/workspace/linked.ts", "/workspace/target.ts"],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("rejects outside canonical targets rather than treating them as vanished matches", async () => {
    mockContainerCanonicalPaths({ "/workspace/linked.ts": "/outside/secret.ts" });
    await expect(
      bridge.stat({ filePath: "/workspace/linked.ts", followSymlinks: true }),
    ).rejects.toThrow(/escapes allowed mounts/);
    await expect(
      createGlobTool("/workspace", { bridge }).execute("outside", { pattern: "linked.ts" }),
    ).rejects.toThrow(/escapes allowed mounts/);
    expect(
      mockedExecDockerRaw.mock.calls.some(
        ([args]) =>
          getDockerScript(args).includes('stat -c "%F|%s|%y"') &&
          getDockerArg(args, 2) === "secret.ts",
      ),
    ).toBe(false);
  });

  it("walks the validated canonical sandbox root while retaining file-link names", async () => {
    await fs.symlink(root, path.join(root, "alias"), "dir");
    mockContainerCanonicalPaths({ "/workspace/alias": "/workspace" });
    const result = await createGlobTool("/workspace", { bridge }).execute("guest-root-link", {
      path: "/workspace/alias",
      pattern: "*.ts",
    });
    expect(result.details).toEqual({
      files: ["/workspace/linked.ts", "/workspace/target.ts"],
      truncated: false,
    });
  });

  it("keeps enumeration inside the workspace even when a separate agent mount is readable", async () => {
    const agentRoot = await fs.mkdtemp(path.join(scratch, "glob-agent-mount-"));
    try {
      const sandbox = createSandbox({ workspaceDir: root, agentWorkspaceDir: agentRoot });
      sandbox.fsBridge = createSandboxFsBridge({ sandbox });
      installMetadataTransport(root, agentRoot);
      expect(
        await sandbox.fsBridge.stat({ filePath: "/agent", followSymlinks: true }),
      ).toMatchObject({
        type: "directory",
      });
      mockedExecDockerRaw.mockClear();
      const tool = createCoreCodingTools({
        codingRoot: root,
        containmentRoot: root,
        includeBaseCodingTools: true,
        shellTools: "disabled",
        workspaceOnly: true,
        readOnly: true,
        sandbox,
        applyPatchEnabled: false,
        applyPatchWorkspaceOnly: true,
        execDefaults: {},
        processDefaults: {},
      }).find((candidate) => candidate.name === "glob")!;
      await expect(tool.execute("agent-mount", { pattern: "*", path: "/agent" })).rejects.toThrow();
      expect(
        mockedExecDockerRaw.mock.calls.some(([args]) => getDockerArg(args, 1) === "readdir"),
      ).toBe(false);
    } finally {
      await fs.rm(agentRoot, { recursive: true, force: true });
    }
  });
});
