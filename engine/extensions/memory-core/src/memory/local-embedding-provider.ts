export const LOCAL_MEMORY_EMBEDDING_PROVIDER_ID = "local";
export const DEFAULT_MEMORY_EMBEDDING_PROVIDER = LOCAL_MEMORY_EMBEDDING_PROVIDER_ID;
export const LLAMA_CPP_PROVIDER_INSTALL_COMMAND =
  "branch plugins install @branch/llama-cpp-provider";

/** Shown in the UI and logs when no on-device embedder can run. */
export const LOCAL_MEMORY_SEARCH_UNAVAILABLE_MESSAGE =
  "Search by meaning is off until this computer has the small model that powers it. Branch still finds memories by matching words.";

export const MISSING_LOCAL_MEMORY_EMBEDDING_PROVIDER_MESSAGE = [
  LOCAL_MEMORY_SEARCH_UNAVAILABLE_MESSAGE,
  "Local GGUF embeddings are provided by the official llama.cpp provider plugin.",
  "Semantic memory recall is degraded until the managed llama-server is configured.",
  `Install it with: ${LLAMA_CPP_PROVIDER_INSTALL_COMMAND}`,
  "Then run `branch configure` and choose llama.cpp to set up the managed llama-server.",
  "Then restart Branch Agent and retry: branch memory status --deep",
].join("\n");

const PAID_REMOTE_MEMORY_EMBEDDING_PROVIDERS = new Set([
  "openai",
  "gemini",
  "google",
  "voyage",
  "mistral",
  "bedrock",
  "amazon-bedrock",
  "deepinfra",
  "github-copilot",
  "anthropic",
]);

export function resolveDefaultMemoryEmbeddingProvider(rawProvider: string | undefined): string {
  const provider = rawProvider?.trim();
  if (!provider || provider === "auto") {
    return DEFAULT_MEMORY_EMBEDDING_PROVIDER;
  }
  return provider;
}

export function isPaidRemoteMemoryEmbeddingProvider(providerId: string): boolean {
  return PAID_REMOTE_MEMORY_EMBEDDING_PROVIDERS.has(providerId.trim().toLowerCase());
}

/** Paid remotes are used only when the user set that provider (or an explicit fallback). */
export function resolveMemoryEmbeddingFallback(params: {
  rawProvider: string | undefined;
  rawFallback: string | undefined;
}): string {
  const fallback = params.rawFallback?.trim() || "none";
  if (fallback === "none" || !isPaidRemoteMemoryEmbeddingProvider(fallback)) {
    return fallback;
  }
  const explicitProvider = params.rawProvider?.trim();
  if (!explicitProvider || explicitProvider === "auto") {
    return "none";
  }
  return fallback;
}
