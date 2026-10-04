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
const credentialPath = "plugins.entries.sofya.config.webFetch.apiKey";

export function createSofyaFetchProvider(): WebFetchProviderPlugin {
  return {
    id: "sofya",
    label: "Sofya Fetch",
    hint: "Fetch a public page as clean Markdown",
    credentialLabel: "Sofya API key",
    envVars: ["SOFYA_API_KEY"],
    placeholder: "API key",
    signupUrl: "https://sofya.co",
    credentialPath,
    inactiveSecretPaths: [credentialPath],
    getCredentialValue: (config) => getScopedCredentialValue(config, "sofya"),
    setCredentialValue: (config, value) => setScopedCredentialValue(config, "sofya", value),
    getConfiguredCredentialValue: (config) =>
      asOptionalRecord(asOptionalRecord(config?.plugins?.entries?.sofya?.config)?.webFetch)?.apiKey,
    setConfiguredCredentialValue: (config, value) => {
      const entry = (((config.plugins ??= {}).entries ??= {}).sofya ??= {});
      const pluginConfig = (entry.config ??= {});
      const fetch = asOptionalRecord(pluginConfig.webFetch) ?? {};
      fetch.apiKey = value;
      pluginConfig.webFetch = fetch;
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "sofya").config,
    createTool: ({ config }) => ({
      description: "Fetch a public web page using Sofya and return its Markdown content.",
      parameters: {},
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        const { runSofyaFetch } = await loadClient();
        return runSofyaFetch({
          cfg: config,
          url: typeof args.url === "string" ? args.url : "",
          maxChars:
            typeof args.maxChars === "number" && args.maxChars > 0 ? args.maxChars : undefined,
          signal: context?.signal,
        });
      },
    }),
  };
}
