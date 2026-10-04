// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/vercel-ai-gateway.ts.
// Registers Vercel AI Gateway as an explicit memory embedding provider (no auto-selection, as in Roo).
import {
  embeddingProviderOwnsDestination,
  sanitizeEmbeddingCacheHeaders,
  type MemoryEmbeddingProviderAdapter,
} from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import {
  createVercelAiGatewayEmbeddingProvider,
  DEFAULT_VERCEL_AI_GATEWAY_EMBEDDING_MODEL,
  VERCEL_AI_GATEWAY_EMBEDDING_BASE_URL,
} from "./embedding-provider.js";

const EXCLUDED_EMBEDDING_HEADERS = ["authorization", "content-type", "x-api-key", "api-key"];

export const vercelAiGatewayEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "vercel-ai-gateway",
  defaultModel: DEFAULT_VERCEL_AI_GATEWAY_EMBEDDING_MODEL,
  transport: "remote",
  authProviderId: "vercel-ai-gateway",
  create: async (options) => {
    const { provider, client } = await createVercelAiGatewayEmbeddingProvider({
      ...options,
      provider: "vercel-ai-gateway",
    });
    const headers = sanitizeEmbeddingCacheHeaders(client.headers, EXCLUDED_EMBEDDING_HEADERS);
    const usesDefaultIdentity =
      headers.length === 0 &&
      embeddingProviderOwnsDestination({
        baseUrl: client.baseUrl,
        providerBaseUrl: VERCEL_AI_GATEWAY_EMBEDDING_BASE_URL,
      });
    return {
      provider,
      runtime: {
        id: "vercel-ai-gateway",
        cacheKeyData: {
          provider: "vercel-ai-gateway",
          model: client.model,
          ...(usesDefaultIdentity ? {} : { baseUrl: client.baseUrl, headers }),
        },
      },
    };
  },
};
