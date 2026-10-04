import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import { readPositiveIntegerParam } from "branch/plugin-sdk/param-readers";
import {
  enablePluginInConfig,
  type WebFetchProviderPlugin,
} from "branch/plugin-sdk/provider-web-fetch-contract";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";

const loadClient = createLazyRuntimeModule(() => import("./client.js"));
const credentialPath = "plugins.entries.groundroute.config.webFetch.apiKey";

export function createGroundRouteFetchProvider(): WebFetchProviderPlugin {
  return {
    id: "groundroute",
    label: "GroundRoute",
    hint: "Extract pages through GroundRoute's page route",
    envVars: ["GROUNDROUTE_API_KEY"],
    credentialLabel: "GroundRoute API key",
    placeholder: "GroundRoute API key",
    signupUrl: "https://groundroute.ai/keys",
    credentialPath,
    inactiveSecretPaths: [credentialPath],
    getCredentialValue: (config) => asOptionalRecord(config?.groundroute)?.apiKey,
    setCredentialValue: (config, value) => {
      const scoped = asOptionalRecord(config.groundroute) ?? {};
      scoped.apiKey = value;
      config.groundroute = scoped;
    },
    getConfiguredCredentialValue: (config) =>
      asOptionalRecord(asOptionalRecord(config?.plugins?.entries?.groundroute?.config)?.webFetch)
        ?.apiKey,
    setConfiguredCredentialValue: (config, value) => {
      const plugins = (config.plugins ??= {});
      const entries = (plugins.entries ??= {});
      const entry = (entries.groundroute ??= {});
      const pluginConfig = (entry.config ??= {});
      const scoped = asOptionalRecord(pluginConfig.webFetch) ?? {};
      scoped.apiKey = value;
      pluginConfig.webFetch = scoped;
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "groundroute").config,
    createTool: ({ config }) => ({
      description: "Fetch a provided HTTP(S) URL through GroundRoute's page extraction route.",
      parameters: {},
      execute: async (args, context) => {
        context?.signal?.throwIfAborted();
        const { runGroundRouteFetch } = await loadClient();
        return runGroundRouteFetch({
          cfg: config,
          url: typeof args.url === "string" ? args.url : "",
          extractMode: args.extractMode === "text" ? "text" : "markdown",
          maxChars: readPositiveIntegerParam(args, "maxChars"),
          signal: context?.signal,
        });
      },
    }),
  };
}
