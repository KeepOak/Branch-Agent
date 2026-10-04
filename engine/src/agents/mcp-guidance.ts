/** Harvested from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421, packages/core/src/agent/mcp-guidance.ts. */
import { getPluginToolMeta, type PluginToolMcpMeta } from "../plugins/tool-metadata.js";
import type { AnyAgentTool } from "./tools/common.js";

/** MCP server metadata carried by one tool (mastra `McpMetadata`). */
export type McpMetadata = {
  serverName?: string;
  serverInstructions?: string;
  forwardInstructions?: boolean;
  instructionsMaxLength?: number;
};

const DEFAULT_INSTRUCTIONS_MAX_LENGTH = 512;

export function truncateMcpInstructions(instructions: string, maxLength?: number): string {
  const resolvedMaxLength = maxLength ?? DEFAULT_INSTRUCTIONS_MAX_LENGTH;
  if (resolvedMaxLength < 1) {
    return "";
  }

  return instructions.length > resolvedMaxLength
    ? instructions.slice(0, resolvedMaxLength)
    : instructions;
}

/**
 * Builds a single markdown string of MCP server guidance from a list of tools.
 *
 * Only tools whose server explicitly opted in (`forwardInstructions === true`)
 * and that advertise non-empty instructions are included. Guidance is
 * deduplicated per server, deterministically ordered by server name, and
 * truncated per server using `instructionsMaxLength`.
 *
 * Returns `undefined` when there is nothing to forward.
 */
export function buildMcpServerGuidance(
  tools: Array<{ mcpMetadata?: McpMetadata } | undefined>,
): string | undefined {
  const instructionsByServer = new Map<string, { instructions: string; maxLength?: number }>();

  for (const tool of tools) {
    const metadata = tool?.mcpMetadata;
    if (!metadata?.serverName || metadata.forwardInstructions !== true) {
      continue;
    }

    const instructions = metadata.serverInstructions?.trim();
    if (!instructions || instructionsByServer.has(metadata.serverName)) {
      continue;
    }

    instructionsByServer.set(metadata.serverName, {
      instructions,
      maxLength: metadata.instructionsMaxLength,
    });
  }

  const guidance = [...instructionsByServer.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([serverName, { instructions, maxLength }]) => {
      const truncatedInstructions = truncateMcpInstructions(instructions, maxLength).trim();
      if (!truncatedInstructions) {
        return undefined;
      }

      return `## Guidance from MCP server "${serverName}"\n\n${truncatedInstructions}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  return guidance.length > 0 ? guidance.join("\n\n") : undefined;
}

function toMcpMetadata(mcp: PluginToolMcpMeta | undefined): McpMetadata | undefined {
  if (!mcp) {
    return undefined;
  }
  return {
    serverName: mcp.serverName,
    serverInstructions: mcp.serverInstructions,
    forwardInstructions: mcp.forwardInstructions,
    instructionsMaxLength: mcp.instructionsMaxLength,
  };
}

/**
 * Reads the MCP bridge metadata of a run's direct tools and of the tools kept
 * behind tool search, so guidance reaches the prompt either way.
 */
export function buildMcpServerGuidanceForRun(params: {
  tools: readonly AnyAgentTool[];
  catalogEntries?: ReadonlyArray<{ mcp?: PluginToolMcpMeta }>;
}): string | undefined {
  return buildMcpServerGuidance([
    ...params.tools.map((tool) => ({ mcpMetadata: toMcpMetadata(getPluginToolMeta(tool)?.mcp) })),
    ...(params.catalogEntries ?? []).map((entry) => ({ mcpMetadata: toMcpMetadata(entry.mcp) })),
  ]);
}
