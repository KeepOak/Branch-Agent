import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";

const CREDENTIAL_PATH = "plugins.entries.traversaal.config.webSearch.apiKey";
const loadRuntime = createLazyRuntimeModule(() => import("./provider.runtime.js"));

export function createTraversaalWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "traversaal",
    label: "Traversaal Ares",
    hint: "Web-grounded answers with source URLs",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Traversaal Ares API key",
    envVars: ["TRAVERSAAL_API_KEY"],
    placeholder: "",
    signupUrl: "https://traversaal.ai/",
    credentialPath: CREDENTIAL_PATH,

    ...createWebSearchProviderContractFields({
      credentialPath: CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "traversaal" },
      configuredCredential: { pluginId: "traversaal" },
      selectionPluginId: "traversaal",
    }),
    createTool: (ctx) => ({
      description:
        "Search the web using Traversaal Ares. Provide a specific sentence describing the information to find. Returns an answer and source URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const { executeTraversaalSearch } = await loadRuntime();
        return executeTraversaalSearch(ctx, args, context);
      },
    }),
  };
}
