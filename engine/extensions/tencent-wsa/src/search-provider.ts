import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import { readStringParam } from "branch/plugin-sdk/param-readers";
import {
  createWebSearchProviderContractFields,
  type WebSearchProviderPlugin,
} from "branch/plugin-sdk/provider-web-search-contract";

const CREDENTIAL_PATH = "plugins.entries.tencent-wsa.config.webSearch.apiKey";
const loadClient = createLazyRuntimeModule(() => import("./client.js"));

export function createTencentWsaWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "tencent-wsa",
    label: "Tencent Cloud WSA",
    hint: "Tencent Cloud SearchPro web results",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Tencent Cloud WSA API key",
    envVars: ["TENCENTCLOUD_WSA_APIKEY"],
    credentialPath: CREDENTIAL_PATH,
    placeholder: "WSA API key",
    signupUrl: "https://cloud.tencent.com/product/wsa",
    ...createWebSearchProviderContractFields({
      credentialPath: CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "tencent-wsa" },
      configuredCredential: { pluginId: "tencent-wsa" },
      selectionPluginId: "tencent-wsa",
    }),
    createTool: (ctx) => ({
      description: "Search the web using Tencent Cloud WSA. Returns titles, URLs and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords." },
          count: {
            type: "integer",
            description: "Maximum results to return (default 5, maximum 50).",
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
        const { runTencentWsaSearch } = await loadClient();
        return runTencentWsaSearch({
          config: ctx.config,
          query: readStringParam(args, "query", { required: true }),
          count: args.count,
          signal: context?.signal,
          assertCurrent: context?.assertCurrent,
        });
      },
    }),
  };
}
