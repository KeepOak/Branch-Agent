// Cases ported from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/agent/mcp-guidance.test.ts and __tests__/mcp-instructions.test.ts.
import { describe, expect, it } from "vitest";
import { setPluginToolMeta, type PluginToolMcpMeta } from "../plugins/tool-metadata.js";
import {
  buildMcpServerGuidance,
  buildMcpServerGuidanceForRun,
  truncateMcpInstructions,
  type McpMetadata,
} from "./mcp-guidance.js";
import type { AnyAgentTool } from "./tools/common.js";

function tool(mcpMetadata?: McpMetadata) {
  return { mcpMetadata };
}

describe("truncateMcpInstructions", () => {
  it("returns instructions unchanged when under the limit", () => {
    expect(truncateMcpInstructions("hello", 512)).toBe("hello");
  });

  it("truncates to maxLength characters", () => {
    expect(truncateMcpInstructions("1234567890", 4)).toBe("1234");
  });

  it("defaults to 512 characters when maxLength is undefined", () => {
    const long = "a".repeat(600);
    expect(truncateMcpInstructions(long)).toHaveLength(512);
  });

  it("returns an empty string when maxLength is below 1", () => {
    expect(truncateMcpInstructions("hello", 0)).toBe("");
  });
});

describe("buildMcpServerGuidance", () => {
  it("returns undefined when there are no tools", () => {
    expect(buildMcpServerGuidance([])).toBeUndefined();
  });

  it("does not forward when forwardInstructions is omitted (opt-in)", () => {
    expect(
      buildMcpServerGuidance([tool({ serverName: "db", serverInstructions: "Validate first." })]),
    ).toBeUndefined();
  });

  it("does not forward when forwardInstructions is false", () => {
    expect(
      buildMcpServerGuidance([
        tool({
          serverName: "db",
          serverInstructions: "Validate first.",
          forwardInstructions: false,
        }),
      ]),
    ).toBeUndefined();
  });

  it("forwards when forwardInstructions is true", () => {
    const guidance = buildMcpServerGuidance([
      tool({ serverName: "db", serverInstructions: "Validate first.", forwardInstructions: true }),
    ]);
    expect(guidance).toBe('## Guidance from MCP server "db"\n\nValidate first.');
  });

  it("skips blank instructions", () => {
    expect(
      buildMcpServerGuidance([
        tool({ serverName: "db", serverInstructions: "   ", forwardInstructions: true }),
      ]),
    ).toBeUndefined();
  });

  it("dedupes multiple tools from the same server", () => {
    const guidance = buildMcpServerGuidance([
      tool({ serverName: "db", serverInstructions: "Validate first.", forwardInstructions: true }),
      tool({ serverName: "db", serverInstructions: "Validate first.", forwardInstructions: true }),
    ]);
    expect(guidance!.match(/Guidance from MCP server "db"/g)).toHaveLength(1);
  });

  it("orders servers deterministically by name", () => {
    const guidance = buildMcpServerGuidance([
      tool({ serverName: "zeta", serverInstructions: "Use zeta last.", forwardInstructions: true }),
      tool({
        serverName: "alpha",
        serverInstructions: "Use alpha first.",
        forwardInstructions: true,
      }),
    ]);
    expect(guidance!.indexOf("alpha")).toBeLessThan(guidance!.indexOf("zeta"));
  });

  it("truncates per-server using instructionsMaxLength", () => {
    const guidance = buildMcpServerGuidance([
      tool({
        serverName: "long",
        serverInstructions: "1234567890",
        forwardInstructions: true,
        instructionsMaxLength: 4,
      }),
    ]);
    expect(guidance).toBe('## Guidance from MCP server "long"\n\n1234');
  });
});

function mcpMeta(serverName: string, extra: Partial<PluginToolMcpMeta> = {}): PluginToolMcpMeta {
  return { serverName, safeServerName: serverName, toolName: "t", operation: "tool", ...extra };
}

function agentTool(name: string, mcp?: PluginToolMcpMeta): AnyAgentTool {
  const created = {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [], details: {} }),
  } as unknown as AnyAgentTool;
  if (mcp) {
    setPluginToolMeta(created, { pluginId: "bundle-mcp", optional: false, mcp });
  }
  return created;
}

describe("buildMcpServerGuidanceForRun (mcp-instructions.test.ts cases)", () => {
  it("adds MCP instructions for an opted-in server", () => {
    const guidance = buildMcpServerGuidanceForRun({
      tools: [
        agentTool(
          "query",
          mcpMeta("db-tools", {
            serverInstructions: "Always call validate_schema before migrate_schema.",
            forwardInstructions: true,
            instructionsMaxLength: 512,
          }),
        ),
        agentTool("read"),
      ],
    });
    expect(guidance).toContain('## Guidance from MCP server "db-tools"');
    expect(guidance).toContain("Always call validate_schema before migrate_schema.");
  });

  it("handles multiple MCP servers in stable server-name order across direct and searchable tools", () => {
    const guidance = buildMcpServerGuidanceForRun({
      tools: [
        agentTool(
          "zetaTool",
          mcpMeta("zeta", {
            serverInstructions: "Use zeta last.",
            forwardInstructions: true,
          }),
        ),
      ],
      catalogEntries: [
        {
          mcp: mcpMeta("alpha", {
            serverInstructions: "Use alpha first.",
            forwardInstructions: true,
          }),
        },
      ],
    });
    expect(guidance).toContain('## Guidance from MCP server "alpha"\n\nUse alpha first.');
    expect(guidance!.indexOf("alpha")).toBeLessThan(guidance!.indexOf("zeta"));
  });

  it("adds nothing when servers did not opt in", () => {
    expect(
      buildMcpServerGuidanceForRun({
        tools: [agentTool("query", mcpMeta("db", { serverInstructions: "Validate first." }))],
      }),
    ).toBeUndefined();
  });
});
