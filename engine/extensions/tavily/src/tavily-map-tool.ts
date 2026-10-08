// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:integrations/tavily/src/map.ts (atlas RESEARCH-0003). Adapted to Branch plugin tools and guarded Tavily transport; upstream options and defaults retained.
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-runtime";
import {
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "branch/plugin-sdk/provider-web-search";
import { Type } from "typebox";
import { runTavilyDiscovery } from "./tavily-client.js";
import { resolveTavilyToolConfig, type TavilyToolConfigContext } from "./tavily-tool-config.js";
const inputSchema = Type.Object(
  {
    url: Type.String({ description: "The root URL to begin mapping." }),
    maxDepth: Type.Optional(Type.Number({ description: "Max depth from the base URL." })),
    maxBreadth: Type.Optional(Type.Number({ description: "Max links to follow per page." })),
    limit: Type.Optional(Type.Number({ description: "Total pages or links to process." })),
    instructions: Type.Optional(Type.String()),
    selectPaths: Type.Optional(Type.Array(Type.String())),
    selectDomains: Type.Optional(Type.Array(Type.String())),
    excludePaths: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    allowExternal: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const outputSchema = Type.Object({
  baseUrl: Type.String(),
  results: Type.Array(Type.String()),
  responseTime: Type.Number(),
});

export function createTavilyMapTool(api: BranchPluginApi, ctx?: TavilyToolConfigContext) {
  return {
    name: "tavily_map",
    label: "Tavily Map",
    description:
      "Map a website's structure starting from a URL using Tavily. Discovers and returns a list of URLs found on the site without extracting page content. Useful for understanding site structure before targeted extraction.",
    resultContentSource: "network" as const,
    parameters: inputSchema,
    outputSchema,
    execute: async (_toolCallId: string, input: Record<string, unknown>, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return jsonResult(
        await runTavilyDiscovery("map", {
          cfg: resolveTavilyToolConfig(api, ctx),
          url: readStringParam(input, "url", { required: true }),
          maxDepth: readNumberParam(input, "maxDepth"),
          maxBreadth: readNumberParam(input, "maxBreadth"),
          limit: readNumberParam(input, "limit"),
          instructions: readStringParam(input, "instructions") || undefined,
          selectPaths: readStringArrayParam(input, "selectPaths"),
          selectDomains: readStringArrayParam(input, "selectDomains"),
          excludePaths: readStringArrayParam(input, "excludePaths"),
          excludeDomains: readStringArrayParam(input, "excludeDomains"),
          allowExternal: typeof input.allowExternal === "boolean" ? input.allowExternal : undefined,
          ...(signal ? { signal } : {}),
        }),
      );
    },
  };
}
