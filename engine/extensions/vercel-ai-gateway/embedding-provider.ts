// Adapted from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 src/services/code-index/embedders/vercel-ai-gateway.ts.
// Roo wraps its OpenAI-compatible embedder with the gateway's /v1 base URL; Branch uses the shared remote client.
import {
  createRemoteEmbeddingProvider,
  normalizeEmbeddingModelWithPrefixes,
  resolveRemoteEmbeddingClient,
  type MemoryEmbeddingProvider,
  type MemoryEmbeddingProviderCreateOptions,
  type RemoteEmbeddingClient,
} from "branch/plugin-sdk/memory-core-host-engine-embeddings";
import { VERCEL_AI_GATEWAY_BASE_URL } from "./models.js";

export const DEFAULT_VERCEL_AI_GATEWAY_EMBEDDING_MODEL = "openai/text-embedding-3-large";

/** The gateway's OpenAI-compatible embeddings API lives under /v1. */
export const VERCEL_AI_GATEWAY_EMBEDDING_BASE_URL = `${VERCEL_AI_GATEWAY_BASE_URL}/v1`;

function normalizeVercelAiGatewayEmbeddingModel(model: string): string {
  return normalizeEmbeddingModelWithPrefixes({
    model,
    defaultModel: DEFAULT_VERCEL_AI_GATEWAY_EMBEDDING_MODEL,
    prefixes: ["vercel-ai-gateway/"],
  });
}

/** The chat catalog stores the bare gateway origin; embeddings need its /v1 path. */
export function resolveVercelAiGatewayEmbeddingBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/u, "");
  try {
    const url = new URL(trimmed);
    if (url.pathname === "" || url.pathname === "/") {
      return `${trimmed}/v1`;
    }
  } catch {
    return baseUrl;
  }
  return trimmed;
}

export async function createVercelAiGatewayEmbeddingProvider(
  options: MemoryEmbeddingProviderCreateOptions,
): Promise<{ provider: MemoryEmbeddingProvider; client: RemoteEmbeddingClient }> {
  const resolved = await resolveRemoteEmbeddingClient({
    provider: "vercel-ai-gateway",
    options,
    defaultBaseUrl: VERCEL_AI_GATEWAY_EMBEDDING_BASE_URL,
    normalizeModel: normalizeVercelAiGatewayEmbeddingModel,
  });
  const client = {
    ...resolved,
    baseUrl: resolveVercelAiGatewayEmbeddingBaseUrl(resolved.baseUrl),
  };
  return {
    provider: createRemoteEmbeddingProvider({
      id: "vercel-ai-gateway",
      client,
      errorPrefix: "vercel-ai-gateway embeddings failed",
      batchQueryInputs: true,
    }),
    client,
  };
}
