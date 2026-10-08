import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  enablePluginInConfig,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";

const loadClient = createLazyRuntimeModule(() => import("./client.js"));
const credentialPath = "plugins.entries.groundroute.config.webSearch.apiKey";

export function createGroundRouteSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "groundroute",
    label: "GroundRoute",
    hint: "Meta-search routing across multiple engines",
    onboardingScopes: ["text-inference"],
    envVars: ["GROUNDROUTE_API_KEY"],
    credentialLabel: "GroundRoute API key",
    placeholder: "GroundRoute API key",
    signupUrl: "https://groundroute.ai/keys",
    credentialPath,
    ...createWebSearchProviderContractFields({
      credentialPath,
      searchCredential: { type: "scoped", scopeId: "groundroute" },
      configuredCredential: { pluginId: "groundroute" },
    }),
    applySelectionConfig: (config) => enablePluginInConfig(config, "groundroute").config,
    createTool: ({ config }) => ({
      description:
        "Search the web through GroundRoute's meta-search routing. Returns titles, URLs, snippets and source engines.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          count: {
            type: "integer",
            description: "Maximum results (1–50, default configured value or 5).",
            minimum: 1,
            maximum: 50,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const { runGroundRouteSearch } = await loadClient();
        return runGroundRouteSearch({
          cfg: config,
          query: typeof args.query === "string" ? args.query : "",
          count: args.count,
          signal: context?.signal,
          assertCurrent: context?.assertCurrent,
        });
      },
    }),
  };
}
