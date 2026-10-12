import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolvePositiveTimeoutSeconds } from "branch/plugin-sdk/provider-web-search";
import { normalizeSecretInput } from "branch/plugin-sdk/secret-input";
import { resolveReadOnlyEnvSecretRef } from "branch/plugin-sdk/secret-ref-readonly";
import {
  asOptionalRecord,
  normalizeOptionalString,
} from "branch/plugin-sdk/string-coerce-runtime";

export const DEFAULT_TAVILY_BASE_URL = "https://api.tavily.com";
const DEFAULT_TAVILY_SEARCH_TIMEOUT_SECONDS = 30;
const DEFAULT_TAVILY_EXTRACT_TIMEOUT_SECONDS = 60;
const TAVILY_API_KEY_ENV_VAR = "TAVILY_API_KEY";
export const TAVILY_API_KEY_CONFIG_PATH = "plugins.entries.tavily.config.webSearch.apiKey";

function resolveTavilySearchConfig(cfg?: BranchConfig) {
  return asOptionalRecord(cfg?.plugins?.entries?.tavily?.config?.webSearch);
}

export function resolveTavilyApiKey(cfg?: BranchConfig): string | undefined {
  const search = resolveTavilySearchConfig(cfg);
  const resolved = resolveReadOnlyEnvSecretRef({
    value: search?.apiKey,
    path: TAVILY_API_KEY_CONFIG_PATH,
    cfg,
    expectedEnvId: TAVILY_API_KEY_ENV_VAR,
    normalizeValue: normalizeSecretInput,
  });
  if (resolved.status === "available") {
    return resolved.value;
  }
  if (resolved.status === "blocked") {
    return undefined;
  }
  return normalizeSecretInput(process.env.TAVILY_API_KEY) || undefined;
}

export function resolveTavilyBaseUrl(cfg?: BranchConfig): string {
  const search = resolveTavilySearchConfig(cfg);
  const configured =
    (normalizeOptionalString(search?.baseUrl) ?? "") ||
    normalizeSecretInput(process.env.TAVILY_BASE_URL) ||
    "";
  return configured || DEFAULT_TAVILY_BASE_URL;
}

export function resolveTavilySearchTimeoutSeconds(override?: number): number {
  return resolvePositiveTimeoutSeconds(override, DEFAULT_TAVILY_SEARCH_TIMEOUT_SECONDS);
}

export function resolveTavilyExtractTimeoutSeconds(override?: number): number {
  return resolvePositiveTimeoutSeconds(override, DEFAULT_TAVILY_EXTRACT_TIMEOUT_SECONDS);
}
