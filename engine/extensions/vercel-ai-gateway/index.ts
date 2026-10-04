import { defineSingleProviderPluginEntry } from "branch/plugin-sdk/provider-entry";
import { vercelAiGatewayEmbeddingProviderAdapter } from "./embedding-adapter.js";
import { applyVercelAiGatewayConfig, VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF } from "./onboard.js";
import manifest from "./branch.plugin.json" with { type: "json" };
import {
  buildStaticVercelAiGatewayProvider,
  buildVercelAiGatewayProvider,
  resolveVercelAiGatewayModel,
} from "./provider-catalog.js";
import { resolveVercelAiGatewayThinkingProfile } from "./thinking.js";

const PROVIDER_ID = "vercel-ai-gateway";

export default defineSingleProviderPluginEntry({
  id: PROVIDER_ID,
  name: "Vercel AI Gateway Provider",
  description: "Bundled Vercel AI Gateway provider plugin",
  manifest,
  provider: {
    label: "Vercel AI Gateway",
    docsPath: "/providers/vercel-ai-gateway",
    manifestAuth: {
      defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
      applyConfig: applyVercelAiGatewayConfig,
    },
    catalog: {
      discoveryMode: "strict",
      buildProvider: () => buildVercelAiGatewayProvider({ discoveryMode: "strict" }),
      buildStaticProvider: buildStaticVercelAiGatewayProvider,
    },
    resolveDynamicModel: ({ modelId }) => resolveVercelAiGatewayModel(modelId),
    resolveThinkingProfile: ({ modelId }) => resolveVercelAiGatewayThinkingProfile(modelId),
  },
  register(api) {
    api.registerEmbeddingProvider(vercelAiGatewayEmbeddingProviderAdapter);
  },
});
