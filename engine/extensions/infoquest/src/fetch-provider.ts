import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  enablePluginInConfig,
  type WebFetchProviderPlugin,
} from "branch/plugin-sdk/provider-web-fetch-contract";
import {
  getScopedCredentialValue,
  setScopedCredentialValue,
} from "branch/plugin-sdk/provider-web-search-contract";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";

const loadClient = createLazyRuntimeModule(() => import("./client.js"));
const credentialPath = "plugins.entries.infoquest.config.webFetch.apiKey";

export function createInfoQuestFetchProvider(): WebFetchProviderPlugin {
  return {
    id: "infoquest",
    label: "InfoQuest Fetch",
    hint: "Fetch a public page as clean Markdown",
    credentialLabel: "InfoQuest API key",
    envVars: ["INFOQUEST_API_KEY"],
    placeholder: "INFOQUEST_API_KEY",
    signupUrl: "https://docs.byteplus.com/en/docs/InfoQuest/What_is_Info_Quest",
    credentialPath,
    inactiveSecretPaths: [credentialPath],
    getCredentialValue: (config) => getScopedCredentialValue(config, "infoquest"),
    setCredentialValue: (config, value) => setScopedCredentialValue(config, "infoquest", value),
    getConfiguredCredentialValue: (config) =>
      asOptionalRecord(asOptionalRecord(config?.plugins?.entries?.infoquest?.config)?.webFetch)
        ?.apiKey,
    setConfiguredCredentialValue: (config, value) => {
      const entry = (((config.plugins ??= {}).entries ??= {}).infoquest ??= {});
      const pluginConfig = (entry.config ??= {});
      const fetch = asOptionalRecord(pluginConfig.webFetch) ?? {};
      fetch.apiKey = value;
      pluginConfig.webFetch = fetch;
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "infoquest").config,
    createTool: ({ config }) => ({
      description: "Fetch a public web page using InfoQuest and return its Markdown content.",
      parameters: {},
      execute: async (args, context?: { signal?: AbortSignal; assertCurrent?: () => void }) => {
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const { runInfoQuestFetch } = await loadClient();
        context?.signal?.throwIfAborted();
        context?.assertCurrent?.();
        const result = await runInfoQuestFetch({
          cfg: config,
          url: typeof args.url === "string" ? args.url : "",
          maxChars:
            typeof args.maxChars === "number" && args.maxChars > 0 ? args.maxChars : undefined,
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
