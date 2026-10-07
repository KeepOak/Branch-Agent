import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  resolveMcpLoopbackPolicyTools,
  resolveMcpLoopbackScopedTools,
} from "../../gateway/mcp-http.runtime.js";
import type { CliBackendPlugin } from "../../plugins/cli-backend.types.js";
import { loadBundledPluginFacade } from "../../test-utils/bundled-plugin-public-surface.js";
import { execSchema } from "../bash-tools.schemas.js";
import { testing as cliBackendsTesting } from "../cli-backends.test-support.js";
import {
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServerConfig,
} from "../cli-runner.test-helpers.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  resetCliRunnerPrepareTestDeps,
  setCliRunnerPrepareTestDeps,
} from "./prepare.test-support.js";

const { buildAnthropicCliBackend } = await loadBundledPluginFacade<{
  buildAnthropicCliBackend: () => CliBackendPlugin;
}>({ pluginId: "anthropic", artifactBasename: "api.js" });

const searchTool = {
  name: "web_search",
  label: "Search",
  description: "Search",
  parameters: { type: "object", properties: {} },
  execute: vi.fn(),
};
const messageTool = { ...searchTool, name: "message", label: "Message" };
const nodeExecution = vi.fn();
function executionTool(defaults: { host?: string; node?: string } = {}) {
  return {
    ...searchTool,
    name: "exec",
    parameters: execSchema,
    execute: async (_id: string, params: unknown) => {
      if (defaults.host !== "node") {
        throw new Error("Gateway-local execution is forbidden in this node-only proof");
      }
      nodeExecution(defaults, params);
      return { content: [{ type: "text", text: "node execution" }] };
    },
  };
}
vi.mock("../branch-tools.js", () => ({
  createBranchTools: ({ config }: { config: BranchConfig }) =>
    config.tools?.web?.search?.enabled === false ? [messageTool] : [searchTool, messageTool],
}));
vi.mock("../agent-tools.js", () => ({
  createBranchCodingTools: ({ exec }: { exec?: { host?: string; node?: string } }) => [
    executionTool(exec),
  ],
}));
vi.mock("../bash-tools.js", () => ({ createExecTool: executionTool }));
vi.mock("../tools/gateway.js", () => ({
  callGatewayTool: async (method: string) => {
    if (method === "node.list") {
      return { nodes: [{ nodeId: "worker", connected: true, commands: ["system.run"] }] };
    }
    if (method === "computer.status") {
      return { configured: false, available: false };
    }
    throw new Error(`Unexpected Gateway I/O: ${method}`);
  },
}));
let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;
const captureNativeToolAuthority = vi.fn((_tools: readonly string[] | null) => true);
const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);

beforeEach(() => {
  vi.clearAllMocks();
  cliBackendsTesting.setDepsForTest({
    resolvePluginSetupCliBackend: () => undefined,
    resolveRuntimeCliBackends: () => [{ ...buildAnthropicCliBackend(), pluginId: "anthropic" }],
  });
  setCliRunnerPrepareTestDeps({
    isWorkspaceBootstrapPending: async () => false,
    makeBootstrapWarn: () => () => undefined,
    resolveBootstrapContextForRun: async () => ({ bootstrapFiles: [], contextFiles: [] }),
    getActiveMcpLoopbackRuntime: () => ({
      port: 31783,
      ownerToken: "fixture-owner",
      nonOwnerToken: "fixture-reader",
    }),
    createMcpLoopbackServerConfig: createTestMcpLoopbackServerConfig,
    mintMcpLoopbackClientGrant,
    bindMcpLoopbackClientGrantAdmission: () => true,
    revokeMcpLoopbackClientGrant: () => true,
    activateMcpLoopbackClientGrantCapture: () => ({ captureNativeToolAuthority }),
    resolveMcpLoopbackPolicyTools,
    resolveMcpLoopbackScopedTools,
    resolveBranchReferencePaths: async () => ({ docsPath: null, sourcePath: null }),
    prepareClaudeCliSkillsPlugin: async () => ({ args: [], cleanup: async () => {} }),
    getCliLiveSessionGeneration: () => undefined,
    loadManifestModelCatalog: () => [],
  });
  fixture = createCliRunnerPrepareFixture((params) =>
    prepareCliRunContext({ skillsSnapshot: { prompt: "", skills: [] }, ...params }),
  );
});
afterEach(async () => {
  resetCliRunnerPrepareTestDeps();
  cliBackendsTesting.resetDepsForTest();
  await fixture.cleanup();
});

describe("registered Claude CLI search preparation", () => {
  it.each([
    { name: "automatic", config: {}, native: true, sessionSearch: true, managed: true },
    {
      name: "pinned provider",
      config: { tools: { web: { search: { provider: "brave" } } } },
      native: false,
      sessionSearch: true,
      managed: true,
    },
    {
      name: "global off with stale session enable",
      config: { tools: { web: { search: { enabled: false } } } },
      native: false,
      sessionSearch: true,
      managed: false,
    },
    {
      name: "session off overrides an explicit tool allowlist",
      config: {},
      native: false,
      sessionSearch: false,
      managed: false,
      branch: ["exec", "web_search", "message"],
    },
  ] satisfies Array<{
    name: string;
    config: BranchConfig;
    native: boolean;
    sessionSearch: boolean;
    managed: boolean;
    branch?: string[];
  }>)(
    "keeps native authority consistent with $name",
    async ({ config, native, sessionSearch, managed, branch }) => {
      const cfg: BranchConfig = {
        ...config,
        plugins: { enabled: false },
        tools: {
          ...config.tools,
          allow: ["exec", "web_search", "message"],
          // Keep this node-only proof explicit now that ordinary local shell is managed.
          exec: { host: branch ? "auto" : "node", mode: "full" },
        },
      };
      const context = await fixture.prepare({
        provider: "claude-cli",
        config: cfg,
        senderIsOwner: true,
        toolOverrides: { webSearch: sessionSearch },
        model: "fixture-model",
        ...(branch ? { cliToolAvailability: { native: ["Read", "WebSearch"], branch } } : {}),
      });
      try {
        const capture = context.preparedBackend.mcpClientGrantCapture;
        expect(capture).toBeDefined();
        capture!.activate("fixture-capture", () => {});
        capture!.captureNativeTools?.(["Read", "WebSearch"]);
        expect(captureNativeToolAuthority).toHaveBeenLastCalledWith(
          native ? ["read", "web_search"] : ["read"],
        );
        const argv = context.preparedBackend.backend.args ?? [];
        const denied = argv[argv.indexOf("--disallowedTools") + 1] ?? "";
        expect(denied.split(",").includes("WebSearch")).toBe(!native);
        expect
          .soft(context.systemPromptReport.tools.entries.some((tool) => tool.name === "web_search"))
          .toBe(managed);
        expect(
          context.systemPromptReport.tools.entries.some((tool) => tool.name === "message"),
        ).toBe(true);
        const grant = mintMcpLoopbackClientGrant.mock.calls[0]?.[0]?.context;
        expect(grant).toBeDefined();
        expect.soft(grant!.toolsAllow).toEqual(branch);
        const tools = await resolveMcpLoopbackScopedTools({
          cfg,
          context: grant!,
          isGrantCurrent: () => true,
        });
        expect(tools.tools.some((tool) => tool.name === "web_search")).toBe(managed);
        const exec = tools.tools.find((tool) => tool.name === "exec");
        expect(exec).toBeDefined();
        if (branch) {
          expect(exec!.parameters).toMatchObject({
            properties: { host: { enum: expect.arrayContaining(["gateway"]) } },
          });
        } else {
          expect.soft(exec!.parameters).toMatchObject({ properties: { host: { enum: ["node"] } } });
          await exec!.execute(
            "node-proof",
            { command: "node-proof" },
            new AbortController().signal,
          );
          expect(nodeExecution).toHaveBeenCalledWith(expect.objectContaining({ host: "node" }), {
            command: "node-proof",
          });
        }
      } finally {
        await context.preparedBackend.cleanup?.();
      }
    },
  );
});
