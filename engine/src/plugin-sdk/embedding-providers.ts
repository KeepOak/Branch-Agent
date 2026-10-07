/**
 * Public SDK subpath for embedding provider registration and runtime access.
 */
export {
  getEmbeddingProvider,
  listEmbeddingProviders,
} from "../plugins/embedding-provider-runtime.js";

import { ensureProviderLocalService } from "../agents/provider-local-service.js";
import type { ModelProviderLocalServiceConfig } from "../config/types.models.js";

/** Start an embedding-only managed llama.cpp service prepared by the official plugin. */
export async function acquireManagedLlamaCppEmbeddingService(
  target: {
    baseUrl: string;
    headers?: HeadersInit;
    service: ModelProviderLocalServiceConfig;
    reconcile?: (params: { baseUrl: string; signal?: AbortSignal }) => Promise<void>;
  },
  signal?: AbortSignal | null,
) {
  return await ensureProviderLocalService({ ...target, providerId: "llama-cpp" }, signal);
}

export type {
  EmbeddingInput,
  EmbeddingProvider,
  EmbeddingProviderAdapter,
  EmbeddingProviderCallOptions,
  EmbeddingProviderCreateOptions,
  EmbeddingProviderCreateResult,
  EmbeddingProviderIndexIdentity,
  EmbeddingProviderRuntime,
} from "../plugins/embedding-providers.js";
