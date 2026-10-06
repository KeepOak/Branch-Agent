import type { BranchConfig } from "../../config/types.branch.js";
import type { AuthProfileStore } from "./types.js";

export const LEGACY_CLAUDE_PROFILE_ID = "anthropic:manual";

function replaceId(ids: string[], oldId: string, nextId: string): string[] {
  return [...new Set(ids.map((id) => (id === oldId ? nextId : id)))];
}

/** Copy first, keeping the legacy credential usable until the config commit succeeds. */
export function copyLegacyClaudeProfile(
  store: AuthProfileStore,
  nextId: string,
  email?: string,
): boolean {
  return copyClaudeProfile(store, LEGACY_CLAUDE_PROFILE_ID, nextId, email);
}

export function copyClaudeProfile(
  store: AuthProfileStore,
  oldId: string,
  nextId: string,
  email?: string,
): boolean {
  const legacy = store.profiles[oldId];
  if (legacy && legacy.provider !== "anthropic") {
    return false;
  }
  if (
    legacy &&
    store.profiles[nextId] &&
    (store.profiles[nextId].type !== "token" ||
      legacy.type !== "token" ||
      store.profiles[nextId].token !== legacy.token)
  ) {
    return false;
  }
  let changed = false;
  if (legacy && !store.profiles[nextId]) {
    const credential =
      legacy.type === "token"
        ? (() => {
            const {
              identityLookupRetryAt: _retryAt,
              identityLookupFailures: _failures,
              ...rest
            } = legacy;
            return rest;
          })()
        : legacy;
    store.profiles[nextId] = { ...credential, ...(email ? { email } : {}) };
    changed = true;
  }
  if (store.usageStats?.[oldId] && !store.usageStats[nextId]) {
    store.usageStats[nextId] = store.usageStats[oldId];
    changed = true;
  }
  for (const [provider, ids] of Object.entries(store.order ?? {})) {
    if (ids.includes(oldId)) {
      store.order![provider] = replaceId(ids, oldId, nextId);
      changed = true;
    }
  }
  for (const [provider, id] of Object.entries(store.lastGood ?? {})) {
    if (id === oldId) {
      store.lastGood![provider] = nextId;
      changed = true;
    }
  }
  return changed;
}

export function migrateLegacyClaudeConfig(
  config: BranchConfig,
  nextId: string,
  email?: string,
): BranchConfig {
  return migrateClaudeConfig(config, LEGACY_CLAUDE_PROFILE_ID, nextId, email);
}

export function migrateClaudeConfig(
  config: BranchConfig,
  oldId: string,
  nextId: string,
  email?: string,
): BranchConfig {
  const legacy = config.auth?.profiles?.[oldId];
  const profiles = { ...config.auth?.profiles };
  if (legacy && !profiles[nextId]) {
    profiles[nextId] = { ...legacy, ...(email ? { email } : {}) };
  }
  delete profiles[oldId];
  const order = Object.fromEntries(
    Object.entries(config.auth?.order ?? {}).map(([provider, ids]) => [
      provider,
      replaceId(ids, oldId, nextId),
    ]),
  );
  return { ...config, auth: { ...config.auth, profiles, order } };
}
