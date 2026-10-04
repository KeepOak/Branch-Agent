import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";
const loadClient = createLazyRuntimeModule(() => import("./client.js"));
const credentialPath = "plugins.entries.infoquest.config.webSearch.apiKey";
export function createInfoQuestWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "infoquest",
    label: "InfoQuest Search",
    hint: "BytePlus organic pages and news with source URLs",
    onboardingScopes: ["text-inference"],
    credentialLabel: "InfoQuest API key",
    envVars: ["INFOQUEST_API_KEY"],
    placeholder: "INFOQUEST_API_KEY",
    signupUrl: "https://docs.byteplus.com/en/docs/InfoQuest/What_is_Info_Quest",
    credentialPath,
    ...createWebSearchProviderContractFields({
      credentialPath,
      searchCredential: { type: "scoped", scopeId: "infoquest" },
      configuredCredential: { pluginId: "infoquest" },
      selectionPluginId: "infoquest",
    }),
    createTool: ({ config }) => ({
      description:
        "Search the web using InfoQuest. Returns deduplicated pages and news with source URLs.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          site: { type: "string", description: "Optional site filter." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const { runInfoQuestSearch } = await loadClient();
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const result = await runInfoQuestSearch({
          cfg: config,
          query: typeof args.query === "string" ? args.query : "",
          site: typeof args.site === "string" ? args.site : undefined,
          signal: context?.signal,
          assertCurrent: context?.assertCurrent,
        });
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        return result;
      },
    }),
  };
}
