import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";

const CREDENTIAL_PATH = "plugins.entries.google-search.config.webSearch.apiKey";
const loadRuntime = createLazyRuntimeModule(() => import("./provider.runtime.js"));

export function createGoogleSearchWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "google-search",
    label: "Google Custom Search",
    hint: "Google Programmable Search Engine results; requires API key and engine ID",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Google Custom Search API key",
    envVars: ["GOOGLE_SEARCH_API_KEY"],
    placeholder: "",
    signupUrl: "https://programmablesearchengine.google.com/",
    credentialPath: CREDENTIAL_PATH,
    credentialNote: "Also configure webSearch.searchEngineId or GOOGLE_CSE_ID.",
    ...createWebSearchProviderContractFields({
      credentialPath: CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "google-search" },
      configuredCredential: { pluginId: "google-search" },
      selectionPluginId: "google-search",
    }),
    createTool: (ctx) => ({
      description:
        "Search the web using Google Custom Search. Returns Google search results from the configured engine.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, description: "Search query." },
          count: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Maximum results (default: 5).",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const { executeGoogleSearch } = await loadRuntime();
        return executeGoogleSearch(ctx, args, context);
      },
    }),
  };
}
