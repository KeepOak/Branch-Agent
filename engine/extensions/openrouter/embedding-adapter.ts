// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/openrouter.ts.
// Registers OpenRouter as an explicit memory embedding provider (no auto-selection, as in Roo).
import {
  embeddingProviderOwnsDestination,
  sanitizeEmbeddingCacheHeaders,
  type MemoryEmbeddingProviderAdapter,
} from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import {
  createOpenRouterEmbeddingProvider,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
} from "./embedding-provider.js";
import { OPENROUTER_BASE_URL } from "./provider-defaults.js";

const EXCLUDED_EMBEDDING_HEADERS = ["authorization", "content-type", "x-api-key", "api-key"];

export const openrouterEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "openrouter",
  defaultModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  transport: "remote",
  authProviderId: "openrouter",
  create: async (options) => {
    const { provider, client } = await createOpenRouterEmbeddingProvider({
      ...options,
      provider: "openrouter",
    });
    const headers = sanitizeEmbeddingCacheHeaders(client.headers, EXCLUDED_EMBEDDING_HEADERS);
    const usesDefaultIdentity =
      headers.length === 0 &&
      embeddingProviderOwnsDestination({
        baseUrl: client.baseUrl,
        providerBaseUrl: OPENROUTER_BASE_URL,
      });
    return {
      provider,
      runtime: {
        id: "openrouter",
        cacheKeyData: {
          provider: "openrouter",
          model: client.model,
          ...(usesDefaultIdentity ? {} : { baseUrl: client.baseUrl, headers }),
        },
      },
    };
  },
};
