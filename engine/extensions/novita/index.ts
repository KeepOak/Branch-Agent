// Novita plugin entrypoint registers its Branch Agent integration.
import { readConfiguredProviderCatalogEntries } from "branch/plugin-sdk/provider-catalog-shared";
import { defineSingleProviderPluginEntry } from "branch/plugin-sdk/provider-entry";
import { buildProviderReplayFamilyHooks } from "branch/plugin-sdk/provider-model-shared";
import { buildProviderToolCompatFamilyHooks } from "branch/plugin-sdk/provider-tools";
import manifest from "./branch.plugin.json" with { type: "json" };
import { buildNovitaVideoGenerationProvider } from "./video-generation-provider.js";

const PROVIDER_ID = "novita";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "NovitaAI Provider",
  description: "Official Branch Agent NovitaAI provider plugin",
  manifest,
  provider: {
    label: "NovitaAI",
    docsPath: "/providers/novita",
    aliases: ["novita-ai", "novitaai"],
    manifestAuth: {
      noteTitle: "NovitaAI",
      noteMessage: "Manage API keys at https://novita.ai/settings/key-management",
    },
    catalog: {
      discoveryMode: "strict",
      allowExplicitBaseUrl: true,
      liveModelDiscovery: true,
    },
    augmentModelCatalog: ({ config }) =>
      readConfiguredProviderCatalogEntries({
        config,
        providerId: PROVIDER_ID,
      }),
    ...buildProviderReplayFamilyHooks({
      family: "openai-compatible",
      dropReasoningFromHistory: false,
    }),
    ...buildProviderToolCompatFamilyHooks("openai"),
  },
  register(api) {
    api.registerVideoGenerationProvider(buildNovitaVideoGenerationProvider());
  },
});
