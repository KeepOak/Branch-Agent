import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";
import { readSearchTimeRange, SEARCH_TIME_RANGES } from "./search-time-range.js";

const loadClient = createLazyRuntimeModule(() => import("./client.js"));
const credentialPath = "plugins.entries.sofya.config.webSearch.apiKey";

export function createSofyaSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "sofya",
    label: "Sofya Search",
    hint: "Full page content or snippets with relative time filters",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Sofya API key",
    envVars: ["SOFYA_API_KEY"],
    placeholder: "API key",
    signupUrl: "https://sofya.co",
    credentialPath,
    ...createWebSearchProviderContractFields({
      credentialPath,
      searchCredential: { type: "scoped", scopeId: "sofya" },
      configuredCredential: { pluginId: "sofya" },
      selectionPluginId: "sofya",
    }),
    createTool: ({ config }) => ({
      description:
        "Search the web using Sofya. Returns full page content or snippets and source URLs. Supports day, week, month or year publication windows.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords." },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Results, default 5 and maximum 20.",
          },
          time_range: {
            type: "string",
            enum: [...SEARCH_TIME_RANGES],
            description: "Relative publication/update window.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        const timeRange = readSearchTimeRange(args.time_range);
        const { runSofyaSearch } = await loadClient();
        return runSofyaSearch({
          cfg: config,
          query: typeof args.query === "string" ? args.query : "",
          count: args.count,
          timeRange,
          signal: context?.signal,
        });
      },
    }),
  };
}
