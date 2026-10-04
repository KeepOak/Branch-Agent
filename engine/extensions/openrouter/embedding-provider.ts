// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/openrouter.ts, src/shared/embeddingModels.ts.
// Branch's shared remote client returns float arrays, so Roo's base64 SDK workaround is not needed.
import {
  createRemoteEmbeddingProvider,
  normalizeEmbeddingModelWithPrefixes,
  resolveRemoteEmbeddingClient,
  type MemoryEmbeddingProvider,
  type MemoryEmbeddingProviderCreateOptions,
  type RemoteEmbeddingClient,
} from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import { OPENROUTER_BASE_URL } from "./provider-defaults.js";

export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-large";

/** Roo routes to one upstream provider when the user picked one; "[default]" means no routing. */
export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]";

function normalizeOpenRouterEmbeddingModel(model: string): string {
  return normalizeEmbeddingModelWithPrefixes({
    model,
    defaultModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
    prefixes: ["openrouter/"],
  });
}

/**
 * Reads the single upstream provider to pin, from the existing OpenRouter routing config
 * (`models.providers.openrouter.params.provider.only` with one entry), matching Roo's specificProvider.
 */
export function resolveOpenRouterSpecificProvider(
  config: MemoryEmbeddingProviderCreateOptions["config"],
): string | undefined {
  const params = config.models?.providers?.openrouter?.params;
  const routing = params && typeof params === "object" ? params.provider : undefined;
  if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
    return undefined;
  }
  const only = (routing as Record<string, unknown>).only;
  if (Array.isArray(only) && only.length === 1 && typeof only[0] === "string") {
    const name = only[0].trim();
    if (name && name !== OPENROUTER_DEFAULT_PROVIDER_NAME) {
      return name;
    }
  }
  return undefined;
}

/** Request fields Roo adds: provider routing only when a specific provider is chosen. */
export function buildOpenRouterEmbeddingRequestFields(
  specificProvider: string | undefined,
): Record<string, unknown> {
  if (!specificProvider || specificProvider === OPENROUTER_DEFAULT_PROVIDER_NAME) {
    return {};
  }
  return {
    provider: {
      order: [specificProvider],
      only: [specificProvider],
      allow_fallbacks: false,
    },
  };
}

export async function createOpenRouterEmbeddingProvider(
  options: MemoryEmbeddingProviderCreateOptions,
): Promise<{ provider: MemoryEmbeddingProvider; client: RemoteEmbeddingClient }> {
  const client = await resolveRemoteEmbeddingClient({
    provider: "openrouter",
    options,
    defaultBaseUrl: OPENROUTER_BASE_URL,
    normalizeModel: normalizeOpenRouterEmbeddingModel,
  });
  const requestFields = buildOpenRouterEmbeddingRequestFields(
    resolveOpenRouterSpecificProvider(options.config),
  );
  return {
    provider: createRemoteEmbeddingProvider({
      id: "openrouter",
      client,
      errorPrefix: "openrouter embeddings failed",
      // OpenRouter has no query/document wire distinction, so arrays stay one request.
      batchQueryInputs: true,
      buildRequestFields: () => requestFields,
    }),
    client,
  };
}
