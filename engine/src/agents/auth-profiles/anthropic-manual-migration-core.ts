import type { BranchConfig } from "../../config/types.branch.js";
import type { AuthProfileStore } from "./types.js";

export const LEGACY_CLAUDE_PROFILE_ID = "anthropic:manual";

function replaceId(ids: string[], nextId: string): string[] {
  return [...new Set(ids.map((id) => id === LEGACY_CLAUDE_PROFILE_ID ? nextId : id))];
}

/** Copy first, keeping the legacy credential usable until the config commit succeeds. */
export function copyLegacyClaudeProfile(store: AuthProfileStore, nextId: string, email: string): boolean {
  const legacy = store.profiles[LEGACY_CLAUDE_PROFILE_ID];
  if (legacy && legacy.provider !== "anthropic") return false;
  if (legacy && store.profiles[nextId] && (
    store.profiles[nextId].type !== "token" || legacy.type !== "token" ||
    store.profiles[nextId].token !== legacy.token
  )) return false;
  let changed = false;
  if (legacy && !store.profiles[nextId]) {
    store.profiles[nextId] = { ...legacy, email };
    changed = true;
  }
  if (store.usageStats?.[LEGACY_CLAUDE_PROFILE_ID] && !store.usageStats[nextId]) {
    store.usageStats[nextId] = store.usageStats[LEGACY_CLAUDE_PROFILE_ID];
    changed = true;
  }
  for (const [provider, ids] of Object.entries(store.order ?? {})) {
    if (ids.includes(LEGACY_CLAUDE_PROFILE_ID)) {
      store.order![provider] = replaceId(ids, nextId);
      changed = true;
    }
  }
  for (const [provider, id] of Object.entries(store.lastGood ?? {})) {
    if (id === LEGACY_CLAUDE_PROFILE_ID) {
      store.lastGood![provider] = nextId;
      changed = true;
    }
  }
  return changed;
}

export function migrateLegacyClaudeConfig(config: BranchConfig, nextId: string, email: string): BranchConfig {
  const legacy = config.auth?.profiles?.[LEGACY_CLAUDE_PROFILE_ID];
  const profiles = { ...config.auth?.profiles };
  if (legacy && !profiles[nextId]) profiles[nextId] = { ...legacy, email };
  delete profiles[LEGACY_CLAUDE_PROFILE_ID];
  const order = Object.fromEntries(Object.entries(config.auth?.order ?? {}).map(([provider, ids]) => [provider, replaceId(ids, nextId)]));
  return { ...config, auth: { ...config.auth, profiles, order } };
}
