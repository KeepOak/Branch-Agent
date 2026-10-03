import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  asOptionalRecord,
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "branch/plugin-sdk/string-coerce-runtime";

const DEFAULT_DDG_SAFE_SEARCH = "moderate";

export type DdgSafeSearch = "strict" | "moderate" | "off";

function resolveDdgWebSearchConfig(config?: BranchConfig) {
  return asOptionalRecord(config?.plugins?.entries?.duckduckgo?.config?.webSearch);
}

export function resolveDdgRegion(config?: BranchConfig): string | undefined {
  return normalizeOptionalString(resolveDdgWebSearchConfig(config)?.region);
}

export function resolveDdgSafeSearch(config?: BranchConfig): DdgSafeSearch {
  const safeSearch = resolveDdgWebSearchConfig(config)?.safeSearch;
  const normalized = normalizeLowercaseStringOrEmpty(safeSearch);
  if (normalized === "strict" || normalized === "off") {
    return normalized;
  }
  return DEFAULT_DDG_SAFE_SEARCH;
}
