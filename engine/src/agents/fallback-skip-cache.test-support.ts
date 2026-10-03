type FallbackSkipCacheState = {
  buckets: Map<string, Map<string, unknown>>;
  lastGlobalPruneAtMs: number;
};

function getFallbackSkipCacheGlobals() {
  return globalThis as typeof globalThis & {
    branchFallbackSkipCache?: Map<string, Map<string, unknown>>;
    branchFallbackSkipCacheState?: FallbackSkipCacheState;
  };
}

export function resetFallbackSkipCacheForTest(): void {
  const globals = getFallbackSkipCacheGlobals();
  globals.branchFallbackSkipCache?.clear();
  globals.branchFallbackSkipCacheState?.buckets.clear();
  if (globals.branchFallbackSkipCacheState) {
    globals.branchFallbackSkipCacheState.lastGlobalPruneAtMs = 0;
  }
}

export function listFallbackSkipCacheSessionIdsForTest(): string[] {
  const globals = getFallbackSkipCacheGlobals();
  return [...(globals.branchFallbackSkipCacheState?.buckets.keys() ?? [])];
}
