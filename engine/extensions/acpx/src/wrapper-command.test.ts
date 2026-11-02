// ACPX tests cover the npm-cli.js lookup inlined into generated adapter wrappers.
import fs from "node:fs/promises";
import path from "node:path";
import {
  resolvePreferredBranchTmpDir,
  tempWorkspace,
  type TempWorkspace,
} from "branch/plugin-sdk/temp-path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareAcpxCodexAuthConfig } from "./codex-auth-bridge.js";
import { resolveAcpxPluginConfig } from "./config.js";
import { WRAPPER_NPM_CLI_SOURCE } from "./wrapper-command.js";

type ResolveNpmCliPath = (
  execPath: string,
  platform: NodeJS.Platform,
  fileExists: (candidate: string) => boolean,
) => string | undefined;

// Evaluate the exact source the generated wrapper runs, with the platform injected.
const resolveNpmCliPath = new Function(
  "path",
  WRAPPER_NPM_CLI_SOURCE + "\nreturn resolveNpmCliPath;",
)(path) as ResolveNpmCliPath;

function probe(execPath: string, platform: NodeJS.Platform, present: string) {
  const checked: string[] = [];
  const found = resolveNpmCliPath(execPath, platform, (candidate) => {
    checked.push(candidate);
    return candidate === present;
  });
  return { checked, found };
}

describe("resolveNpmCliPath", () => {
  it("finds npm beside node.exe on Windows (setup-node and the official installer)", () => {
    const execPath = "C:\\hostedtoolcache\\windows\\node\\24.11.0\\x64\\node.exe";
    const npmCli =
      "C:\\hostedtoolcache\\windows\\node\\24.11.0\\x64\\node_modules\\npm\\bin\\npm-cli.js";

    expect(probe(execPath, "win32", npmCli)).toEqual({ checked: [npmCli], found: npmCli });
  });

  it("finds npm in a Windows install path with spaces", () => {
    const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";

    expect(probe("C:\\Program Files\\nodejs\\node.exe", "win32", npmCli).found).toBe(npmCli);
  });

  it.each(["darwin", "linux"] as const)("keeps the ../lib npm layout on %s", (platform) => {
    const npmCli = "/usr/local/lib/node_modules/npm/bin/npm-cli.js";

    expect(probe("/usr/local/bin/node", platform, npmCli)).toEqual({
      checked: [npmCli],
      found: npmCli,
    });
  });

  it("returns undefined when npm is not installed with node", () => {
    expect(probe("C:\\node\\node.exe", "win32", "").found).toBeUndefined();
  });
});

describe("generated adapter wrappers", () => {
  let workspace: TempWorkspace;

  beforeEach(async () => {
    workspace = await tempWorkspace({
      rootDir: resolvePreferredBranchTmpDir(),
      prefix: "branch-acpx-wrapper-command-",
    });
  });

  afterEach(async () => {
    await workspace.cleanup();
  });

  it("look up npm-cli.js with the platform-aware helper before falling back to npx", async () => {
    const root = workspace.dir;
    const stateDir = path.join(root, "state");
    await prepareAcpxCodexAuthConfig({
      pluginConfig: resolveAcpxPluginConfig({ rawConfig: {}, workspaceDir: root }),
      stateDir,
      resolveInstalledCodexAcpBinPath: async () => undefined,
      resolveInstalledClaudeAcpBinPath: async () => undefined,
    });

    for (const name of ["codex-acp-wrapper.mjs", "claude-agent-acp-wrapper.mjs"]) {
      const wrapper = await fs.readFile(path.join(stateDir, "acpx", name), "utf8");
      expect(wrapper).toContain(WRAPPER_NPM_CLI_SOURCE);
      expect(wrapper).toContain(
        "const npmCliPath = resolveNpmCliPath(process.execPath, process.platform, existsSync);",
      );
    }
  });
});
