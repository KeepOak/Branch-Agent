// ACPX tests cover config plugin behavior.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { buildPluginConfigSchema } from "branch/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpxPluginConfigSchema } from "./config-schema.js";
import { resolveAcpxPluginConfig, resolveAcpxPluginRoot } from "./config.js";

const requireFromTest = createRequire(import.meta.url);
const TSX_IMPORT = requireFromTest.resolve("tsx");

function expectedMcpServerArgs(params: { sourceEntry: string; distEntry: string }): string[] {
  const distEntry = path.resolve(params.distEntry);
  if (fs.existsSync(distEntry)) {
    return [distEntry];
  }
  return ["--import", TSX_IMPORT, path.resolve(params.sourceEntry)];
}

describe("embedded acpx plugin config", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("resolves state independently of the session working directory", () => {
    const workspaceDir = path.resolve("/tmp/branch-acpx");
    const stateDir = path.resolve("/tmp/branch-state");
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir,
    });

    expect(resolved.cwd).toBe(workspaceDir);
    expect(resolved.stateDir).toBe(path.join(stateDir, "acpx"));
    expect(resolved.permissionMode).toBe("approve-reads");
    expect(resolved.nonInteractivePermissions).toBe("fail");
    expect(resolved.timeoutSeconds).toBe(120);
    expect(resolved.probeAgent).toBeUndefined();
    expect(resolved.agents).toStrictEqual({});
    expect(
      resolveAcpxPluginConfig({ rawConfig: { stateDir: workspaceDir }, stateDir }).stateDir,
    ).toBe(workspaceDir);
    expect(resolveAcpxPluginConfig({ rawConfig: {}, stateDir: workspaceDir }).stateDir).toBe(
      path.join(workspaceDir, "acpx"),
    );
  });

  it("accepts agent command overrides", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        agents: {
          claude: { command: "claude --acp" },
          codex: { command: "codex custom-acp" },
        },
      },
      workspaceDir: "/tmp/branch-acpx",
    });

    expect(resolved.agents).toEqual({
      claude: ["claude", "--acp"],
      codex: ["codex", "custom-acp"],
    });
  });

  it.each([
    {
      platform: "win32",
      command: String.raw`.\agent.exe --stdio`,
      expected: [String.raw`.\agent.exe`, "--stdio"],
    },
    {
      platform: "win32",
      command: String.raw`node C:\tools\agent.js`,
      expected: ["node", String.raw`C:\tools\agent.js`],
    },
    {
      platform: "win32",
      command: String.raw`"\\server\share\agent.exe" "" "C:\work dir\\"`,
      expected: [String.raw`\\server\share\agent.exe`, "", "C:\\work dir\\"],
    },
    {
      platform: "win32",
      command: String.raw`node "say \"hello\""`,
      expected: ["node", 'say "hello"'],
    },
    {
      platform: "linux",
      command: String.raw`node ./some\ file.js ""`,
      expected: ["node", "./some file.js", ""],
    },
  ] as const)("preserves $platform command syntax: $command", ({ platform, command, expected }) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    const config = resolveAcpxPluginConfig({
      rawConfig: { agents: { fixture: { command, args: ["suffix"] } } },
      workspaceDir: "/tmp/branch-acpx",
    });
    expect(config.agents.fixture).toEqual([...expected, "suffix"]);
  });

  it("preserves structured agent args without shell quoting", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        agents: {
          custom: {
            command: "node",
            args: ["/tmp/My Adapter.mjs", "--flag=value with spaces", "owner's-choice"],
          },
        },
      },
      workspaceDir: "/tmp/branch-acpx",
    });

    expect(resolved.agents).toEqual({
      custom: ["node", "/tmp/My Adapter.mjs", "--flag=value with spaces", "owner's-choice"],
    });
  });

  it("rejects incomplete command quoting before creating launch argv", () => {
    expect(() =>
      resolveAcpxPluginConfig({
        rawConfig: { agents: { custom: { command: "node 'unfinished argument" } } },
        workspaceDir: "/tmp/branch-acpx",
      }),
    ).toThrow("unterminated quote");
  });

  it("carries an explicit probeAgent through to the resolved plugin config, trimmed", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        probeAgent: "  OpenCode  ",
      },
      workspaceDir: "/tmp/branch-acpx",
    });

    expect(resolved.probeAgent).toBe("OpenCode");
  });

  it("rejects an empty probeAgent string", () => {
    expect(() =>
      resolveAcpxPluginConfig({
        rawConfig: {
          probeAgent: "",
        },
        workspaceDir: "/tmp/branch-acpx",
      }),
    ).toThrow(/probeAgent must be a non-empty string/);
  });

  it("injects the built-in plugin-tools MCP server only when explicitly enabled", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        pluginToolsMcpBridge: true,
      },
      workspaceDir: "/tmp/branch-acpx",
    });

    const server = resolved.mcpServers["branch-plugin-tools"];
    expect(server).toEqual({
      command: process.execPath,
      args: expectedMcpServerArgs({
        sourceEntry: "src/mcp/plugin-tools-serve.ts",
        distEntry: "dist/mcp/plugin-tools-serve.js",
      }),
    });
  });

  it("injects the built-in Branch Agent tools MCP server only when explicitly enabled", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        branchToolsMcpBridge: true,
      },
      workspaceDir: "/tmp/branch-acpx",
    });

    const server = resolved.mcpServers["branch-tools"];
    expect(server).toEqual({
      command: process.execPath,
      args: expectedMcpServerArgs({
        sourceEntry: "src/mcp/branch-tools-serve.ts",
        distEntry: "dist/mcp/branch-tools-serve.js",
      }),
    });
  });

  it("resolves the plugin root from shared dist chunk paths", () => {
    const moduleUrl = new URL("../../../dist/extensions/acpx/service-shared.js", import.meta.url)
      .href;

    expect(resolveAcpxPluginRoot(moduleUrl)).toBe(path.resolve("extensions/acpx"));
  });

  it("keeps the runtime json schema in sync with the manifest config schema", () => {
    const pluginRoot = resolveAcpxPluginRoot();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, "branch.plugin.json"), "utf8"),
    ) as { configSchema?: unknown };

    expect(buildPluginConfigSchema(AcpxPluginConfigSchema).jsonSchema).toEqual(
      manifest.configSchema,
    );
  });
});
