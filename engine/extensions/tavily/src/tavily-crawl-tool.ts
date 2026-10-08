// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:integrations/tavily/src/crawl.ts (atlas RESEARCH-0003). Adapted to Branch plugin tools and guarded Tavily transport; upstream options and defaults retained.
import { optionalStringEnum } from "branch/plugin-sdk/channel-actions";
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
    url: Type.String({ description: "The root URL to begin crawl." }),
    maxDepth: Type.Optional(Type.Number({ description: "Max depth from the base URL." })),
    maxBreadth: Type.Optional(Type.Number({ description: "Max links to follow per page." })),
    limit: Type.Optional(Type.Number({ description: "Total pages or links to process." })),
    instructions: Type.Optional(Type.String()),
    selectPaths: Type.Optional(Type.Array(Type.String())),
    selectDomains: Type.Optional(Type.Array(Type.String())),
    excludePaths: Type.Optional(Type.Array(Type.String())),
    excludeDomains: Type.Optional(Type.Array(Type.String())),
    allowExternal: Type.Optional(Type.Boolean()),
    extractDepth: optionalStringEnum(["basic", "advanced"] as const),
    includeImages: Type.Optional(Type.Boolean()),
    format: optionalStringEnum(["markdown", "text"] as const),
  },
  { additionalProperties: false },
);
const outputSchema = Type.Object({
  baseUrl: Type.String(),
  results: Type.Array(
    Type.Object({
      url: Type.String(),
      rawContent: Type.String(),
      images: Type.Optional(Type.Array(Type.String())),
    }),
  ),
  responseTime: Type.Number(),
});

export function createTavilyCrawlTool(api: BranchPluginApi, ctx?: TavilyToolConfigContext) {
  return {
    name: "tavily_crawl",
    label: "Tavily Crawl",
    description:
      "Crawl a website starting from a URL using Tavily. Extracts content from discovered pages with configurable depth, breadth, and domain constraints. Returns structured content from each crawled page.",
    resultContentSource: "network" as const,
    parameters: inputSchema,
    outputSchema,
    execute: async (_toolCallId: string, input: Record<string, unknown>, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return jsonResult(
        await runTavilyDiscovery("crawl", {
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
          extractDepth: readStringParam(input, "extractDepth") || undefined,
          includeImages: typeof input.includeImages === "boolean" ? input.includeImages : undefined,
          format: readStringParam(input, "format") || undefined,
          ...(signal ? { signal } : {}),
        }),
      );
    },
  };
}
