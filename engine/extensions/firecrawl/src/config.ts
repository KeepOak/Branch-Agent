import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { asNonNegativeFiniteNumber } from "branch/plugin-sdk/number-runtime";
import { resolvePositiveTimeoutSeconds } from "branch/plugin-sdk/provider-web-fetch";
import { normalizeSecretInput } from "branch/plugin-sdk/secret-input";
import { resolveReadOnlyEnvSecretRef } from "branch/plugin-sdk/secret-ref-readonly";
import {
  asBoolean,
  asOptionalRecord,
  normalizeOptionalString,
} from "branch/plugin-sdk/string-coerce-runtime";

export const DEFAULT_FIRECRAWL_BASE_URL = "https://api.firecrawl.dev";
const DEFAULT_FIRECRAWL_SEARCH_TIMEOUT_SECONDS = 30;
const DEFAULT_FIRECRAWL_SCRAPE_TIMEOUT_SECONDS = 60;
const DEFAULT_FIRECRAWL_MAX_AGE_MS = 172_800_000;
const FIRECRAWL_API_KEY_ENV_VAR = "FIRECRAWL_API_KEY";

type FirecrawlFetchConfig = {
  apiKey?: unknown;
  baseUrl?: string;
  onlyMainContent?: boolean;
  maxAgeMs?: number;
  timeoutSeconds?: number;
};

type FirecrawlSearchConfig = Pick<FirecrawlFetchConfig, "apiKey" | "baseUrl">;
type PluginEntryConfig =
  | {
      webSearch?: FirecrawlSearchConfig;
      webFetch?: FirecrawlFetchConfig;
    }
  | undefined;

function resolveFirecrawlSearchConfig(cfg?: BranchConfig): FirecrawlSearchConfig | undefined {
  const pluginConfig = cfg?.plugins?.entries?.firecrawl?.config as PluginEntryConfig;
  return asOptionalRecord(pluginConfig?.webSearch);
}

function resolveFirecrawlFetchConfig(cfg?: BranchConfig): FirecrawlFetchConfig | undefined {
  const pluginConfig = cfg?.plugins?.entries?.firecrawl?.config as PluginEntryConfig;
  return asOptionalRecord(pluginConfig?.webFetch);
}

function resolveConfiguredSecret(value: unknown, path: string, cfg?: BranchConfig) {
  return resolveReadOnlyEnvSecretRef({
    value,
    path,
    cfg,
    expectedEnvId: FIRECRAWL_API_KEY_ENV_VAR,
    normalizeValue: normalizeSecretInput,
  });
}

export function resolveFirecrawlApiKey(cfg?: BranchConfig): string | undefined {
  const pluginConfig = cfg?.plugins?.entries?.firecrawl?.config as PluginEntryConfig;
  const search = resolveFirecrawlSearchConfig(cfg);
  const configuredCandidates: Array<{ value: unknown; path: string }> = [
    {
      value: pluginConfig?.webFetch?.apiKey,
      path: "plugins.entries.firecrawl.config.webFetch.apiKey",
    },
    {
      value: search?.apiKey,
      path: "plugins.entries.firecrawl.config.webSearch.apiKey",
    },
  ];
  let blockedConfiguredSecret = false;
  for (const candidate of configuredCandidates) {
    const resolved = resolveConfiguredSecret(candidate.value, candidate.path, cfg);
    if (resolved.status === "available") {
      return resolved.value;
    }
    if (resolved.status === "blocked") {
      blockedConfiguredSecret = true;
    }
  }
  if (blockedConfiguredSecret) {
    return undefined;
  }
  return normalizeSecretInput(process.env[FIRECRAWL_API_KEY_ENV_VAR]) || undefined;
}

export function resolveFirecrawlBaseUrl(cfg?: BranchConfig): string {
  const search = resolveFirecrawlSearchConfig(cfg);
  const fetch = resolveFirecrawlFetchConfig(cfg);
  const configured =
    normalizeOptionalString(search?.baseUrl) ||
    normalizeOptionalString(fetch?.baseUrl) ||
    normalizeSecretInput(process.env.FIRECRAWL_BASE_URL) ||
    "";
  return configured || DEFAULT_FIRECRAWL_BASE_URL;
}

export function resolveFirecrawlOnlyMainContent(cfg?: BranchConfig, override?: boolean): boolean {
  return (
    asBoolean(override) ?? asBoolean(resolveFirecrawlFetchConfig(cfg)?.onlyMainContent) ?? true
  );
}

export function resolveFirecrawlMaxAgeMs(cfg?: BranchConfig, override?: number): number {
  return Math.floor(
    asNonNegativeFiniteNumber(override) ??
      asNonNegativeFiniteNumber(resolveFirecrawlFetchConfig(cfg)?.maxAgeMs) ??
      DEFAULT_FIRECRAWL_MAX_AGE_MS,
  );
}

export function resolveFirecrawlScrapeTimeoutSeconds(
  cfg?: BranchConfig,
  override?: number,
): number {
  const fetch = resolveFirecrawlFetchConfig(cfg);
  return resolvePositiveTimeoutSeconds(
    override,
    resolvePositiveTimeoutSeconds(fetch?.timeoutSeconds, DEFAULT_FIRECRAWL_SCRAPE_TIMEOUT_SECONDS),
  );
}

export function resolveFirecrawlSearchTimeoutSeconds(override?: number): number {
  return resolvePositiveTimeoutSeconds(override, DEFAULT_FIRECRAWL_SEARCH_TIMEOUT_SECONDS);
}
