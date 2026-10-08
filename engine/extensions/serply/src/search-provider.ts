import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";

const credentialPath = "plugins.entries.serply.config.webSearch.apiKey";
const client = createLazyRuntimeModule(() => import("./client.js"));

export function createSerplyWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "serply",
    label: "Serply",
    hint: "Google web, News and Scholar results",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Serply API key",
    placeholder: "Serply API key",
    envVars: ["SERPLY_API_KEY"],
    signupUrl: "https://serply.io",
    docsUrl: "https://serply.io/docs",
    credentialPath,
    ...createWebSearchProviderContractFields({
      credentialPath,
      searchCredential: { type: "scoped", scopeId: "serply" },
      configuredCredential: { pluginId: "serply" },
      selectionPluginId: "serply",
    }),
    createTool: (ctx) => ({
      description:
        "Search Google through Serply. The configured vertical selects web, News or Scholar; Scholar returns authors, citation counts and PDF links.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords.", maxLength: 500 },
          count: {
            type: "integer",
            description: "Maximum results, default 5 (1-100).",
            minimum: 1,
            maximum: 100,
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, execution) => {
        execution?.signal?.throwIfAborted();
        if (typeof args.query !== "string") {
          throw new Error("query must be a string");
        }
        const { runSerplySearch } = await client();
        return await runSerplySearch({
          cfg: ctx.config,
          searchConfig: ctx.searchConfig,
          query: args.query,
          count: args.count,
          signal: execution?.signal,
        });
      },
    }),
  };
}
