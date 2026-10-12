import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { normalizeSecretInput } from "branch/plugin-sdk/secret-input";
import { resolveReadOnlyEnvSecretRef } from "branch/plugin-sdk/secret-ref-readonly";
import {
  asOptionalRecord,
  normalizeOptionalString,
} from "branch/plugin-sdk/string-coerce-runtime";

const SEARXNG_BASE_URL_ENV_VAR = "SEARXNG_BASE_URL";
const SEARXNG_BASE_URL_PATH = "plugins.entries.searxng.config.webSearch.baseUrl";

function normalizeBaseUrl(value: unknown): string | undefined {
  return normalizeSecretInput(value)?.replace(/\/+$/u, "") || undefined;
}

function resolveSearxngWebSearchConfig(config?: BranchConfig) {
  return asOptionalRecord(config?.plugins?.entries?.searxng?.config?.webSearch);
}

export function resolveSearxngBaseUrl(config?: BranchConfig): string | undefined {
  const webSearch = resolveSearxngWebSearchConfig(config);
  const resolved = resolveReadOnlyEnvSecretRef({
    value: webSearch?.baseUrl,
    path: SEARXNG_BASE_URL_PATH,
    cfg: config,
    expectedEnvId: SEARXNG_BASE_URL_ENV_VAR,
    normalizeValue: normalizeBaseUrl,
  });
  if (resolved.status === "available") {
    return resolved.value;
  }
  if (resolved.status === "blocked") {
    return undefined;
  }
  return normalizeBaseUrl(process.env[SEARXNG_BASE_URL_ENV_VAR]);
}

export function resolveSearxngCategories(config?: BranchConfig): string | undefined {
  return normalizeOptionalString(resolveSearxngWebSearchConfig(config)?.categories);
}

export function resolveSearxngLanguage(config?: BranchConfig): string | undefined {
  return normalizeOptionalString(resolveSearxngWebSearchConfig(config)?.language);
}
