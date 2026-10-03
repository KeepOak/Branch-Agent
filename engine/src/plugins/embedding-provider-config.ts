import {
  findNormalizedProviderValue,
  normalizeProviderId,
} from "@branch/model-catalog-core/provider-id";
import type { BranchConfig } from "../config/types.branch.js";

const OPENAI_COMPATIBLE_EMBEDDING_PROVIDER_ID = "openai-compatible";
const OPENAI_COMPATIBLE_MODEL_APIS = new Set(["openai-completions", "openai-responses"]);

/** Reads a configured provider's backing API id when runtime lookup should follow an alias. */
export function resolveConfiguredGenericEmbeddingProviderId(
  providerId: string,
  cfg?: BranchConfig,
): string | undefined {
  const providers = cfg?.models?.providers;
  const providerConfig =
    providers?.[providerId] ?? findNormalizedProviderValue(providers, providerId);
  if (!providerConfig) {
    return undefined;
  }
  const api = providerConfig.api?.trim();
  const normalizedApi = api ? normalizeProviderId(api) : undefined;
  const resolvedProviderId = normalizedApi
    ? OPENAI_COMPATIBLE_MODEL_APIS.has(normalizedApi)
      ? OPENAI_COMPATIBLE_EMBEDDING_PROVIDER_ID
      : normalizedApi
    : providerConfig.baseUrl?.trim()
      ? OPENAI_COMPATIBLE_EMBEDDING_PROVIDER_ID
      : undefined;
  return resolvedProviderId && resolvedProviderId !== normalizeProviderId(providerId)
    ? resolvedProviderId
    : undefined;
}
