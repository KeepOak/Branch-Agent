// Agent-level cases ported from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/agent/__tests__/mcp-instructions.test.ts: opted-in MCP server
// instructions reach the system prompt; servers that did not opt in add nothing.
import { describe, expect, it, vi } from "vitest";
import { setPluginToolMeta, type PluginToolMcpMeta } from "../../../plugins/tool-metadata.js";
import { prepareSystemAgentRunAdmission } from "../../admitted-run-context.js";
import { buildBootstrapBudgetState } from "../../bootstrap-budget.js";
import { createAgentHarnessToolSurfaceRuntimeCore } from "../../harness/tool-surface-bridge.js";
import { createStubTool } from "../../test-helpers/agent-tool-stubs.js";
import { makeProviderModelFixture } from "../../test-helpers/provider-model-fixture.js";
import { createToolSearchTools } from "../../tool-search.js";
import { createAttemptSetupFixture } from "./attempt-setup.test-support.js";
import { prepareEmbeddedAttemptSystemPrompt } from "./attempt-system-prompt-prepare.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

const { createFixture } = await vi.hoisted(
  async () => await import("./attempt-prompt-phase.test-support.js"),
);
vi.mock("../../../plugins/providers.runtime-core.js", () => ({
  createProviderRegistryResolver: () => ({
    isPluginProvidersLoadInFlight: () => {
      throw new Error("Unexpected provider discovery");
    },
    resolvePluginProvidersCore: () => {
      throw new Error("Unexpected provider discovery");
    },
  }),
}));

function mcpTool(name: string, mcp: Partial<PluginToolMcpMeta> & { serverName: string }) {
  const tool = createStubTool(name);
  setPluginToolMeta(tool, {
    pluginId: "bundle-mcp",
    optional: false,
    mcp: { safeServerName: mcp.serverName, toolName: name, operation: "tool", ...mcp },
  });
  return tool;
}

async function preparePrompt(params: {
  toolSearch: boolean;
  tools: ReturnType<typeof createStubTool>[];
}) {
  const fixture = createFixture({ pendingImageCount: 0 });
  const config = {
    agents: { defaults: { experimental: { localModelLean: false } } },
    tools: { codeMode: false, toolSearch: { enabled: params.toolSearch, mode: "tools" as const } },
  };
  const runtime = createAgentHarnessToolSurfaceRuntimeCore({
    config,
    modelToolsEnabled: true,
    executeTool: async () => ({ content: [], details: {} }),
  });
  const admission = prepareSystemAgentRunAdmission(
    config,
    fixture.input.attempt.runId,
    "main",
    "mcp-guidance-prompt-test",
  );
  try {
    const surface = params.toolSearch
      ? runtime.compactTools([
          ...createToolSearchTools({
            config: runtime.config,
            catalogRef: runtime.toolSearchCatalogRef,
          }),
          ...params.tools,
        ])
      : { tools: params.tools };
    const attempt = {
      ...fixture.input.attempt,
      admittedRunContext: await admission.admit("embedded"),
      config,
      prompt: "Run the migration",
      promptMode: "full",
      sessionKey: "agent:main:mcp-guidance",
      workspaceDir: "/workspace",
      model: makeProviderModelFixture({
        provider: "openai",
        id: "test-model",
        api: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      }),
    } as EmbeddedRunAttemptParams;
    const prepared = await prepareEmbeddedAttemptSystemPrompt({
      activeContextEngine: undefined,
      attempt,
      bootstrap: {
        ...buildBootstrapBudgetState({ files: [] }),
        bootstrapMode: "full",
        contextFiles: [],
        bootstrapInjectionStats: [],
        shouldRecordCompletedBootstrapTurn: false,
        workspaceNotes: [],
      },
      setup: createAttemptSetupFixture({
        effectiveCwd: "/workspace",
        effectiveWorkspace: "/workspace",
        getProviderRuntimeHandle: () => ({
          provider: attempt.provider,
          modelId: attempt.modelId,
          prepared: true,
        }),
      }),
      capabilityToolNames: new Set(params.tools.map((tool) => tool.name)),
      effectiveTools: surface.tools,
      isRawModelRun: false,
      modelToolsEnabled: true,
      skillsPrompt: "",
      toolSearchDirectoryEnabled: false,
      toolSearchRuntimeConfig: runtime.config,
      toolSearchCatalogRef: runtime.toolSearchCatalogRef,
    });
    return prepared.systemPromptText;
  } finally {
    admission.close();
    runtime.cleanup();
  }
}

describe("MCP server instructions in the embedded system prompt", () => {
  it("adds MCP instructions for opted-in servers in stable server-name order", async () => {
    const prompt = await preparePrompt({
      toolSearch: false,
      tools: [
        mcpTool("zeta__run", {
          serverName: "zeta",
          serverInstructions: "Use zeta last.",
          forwardInstructions: true,
        }),
        mcpTool("alpha__run", {
          serverName: "alpha",
          serverInstructions: "Use alpha first.",
          forwardInstructions: true,
        }),
        createStubTool("read"),
      ],
    });
    expect(prompt).toContain('## Guidance from MCP server "alpha"\n\nUse alpha first.');
    expect(prompt).toContain('## Guidance from MCP server "zeta"\n\nUse zeta last.');
    expect(prompt.indexOf('"alpha"')).toBeLessThan(prompt.indexOf('"zeta"'));
  });

  it("does not add MCP guidance when the server did not opt in", async () => {
    const prompt = await preparePrompt({
      toolSearch: false,
      tools: [mcpTool("db__query", { serverName: "db", serverInstructions: "Validate first." })],
    });
    expect(prompt).not.toContain("Guidance from MCP server");
    expect(prompt).not.toContain("Validate first.");
  });

  it("keeps guidance for MCP tools held behind tool search", async () => {
    const prompt = await preparePrompt({
      toolSearch: true,
      tools: [
        mcpTool("db__migrate_schema", {
          serverName: "db-tools",
          serverInstructions: "Always call validate_schema before migrate_schema.",
          forwardInstructions: true,
        }),
      ],
    });
    expect(prompt).toContain(
      '## Guidance from MCP server "db-tools"\n\nAlways call validate_schema before migrate_schema.',
    );
  });
});
