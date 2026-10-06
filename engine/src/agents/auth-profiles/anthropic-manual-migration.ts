import fs from "node:fs/promises";
import { writeConfigFile } from "../../config/io.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { openNodeSqliteDatabase } from "../../infra/node-sqlite.js";
import { backupNodeSqliteDatabase } from "../../infra/sqlite-backup.js";
import { resolveAnthropicTokenIdentity } from "../../plugins/provider-auth-token.js";
import {
  copyClaudeProfile,
  copyLegacyClaudeProfile,
  LEGACY_CLAUDE_PROFILE_ID,
  migrateClaudeConfig,
  migrateLegacyClaudeConfig,
} from "./anthropic-manual-migration-core.js";
import {
  listCandidateAuthProfileStores,
  loadCandidateAuthProfileStore,
  updateCandidateAuthProfileStore,
  type CandidateAuthProfileStore,
} from "./candidate-stores.js";
const LEGACY_ID = LEGACY_CLAUDE_PROFILE_ID;
const ID_PROFILE = /^anthropic:id-[a-f0-9]{12}$/;
const BASE_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 24 * 60 * 60_000;

function scheduleRetry(
  credential: { identityLookupFailures?: number; identityLookupRetryAt?: number },
  retryAfterMs?: number,
): void {
  const failures = (credential.identityLookupFailures ?? 0) + 1;
  credential.identityLookupFailures = failures;
  credential.identityLookupRetryAt =
    Date.now() +
    Math.max(
      Math.min(BASE_RETRY_MS * 2 ** Math.min(failures - 1, 8), MAX_RETRY_MS),
      retryAfterMs ?? 0,
    );
}

async function backupCandidate(candidate: CandidateAuthProfileStore): Promise<void> {
  try {
    await fs.access(candidate.databasePath);
  } catch {
    return;
  }
  const db = openNodeSqliteDatabase(candidate.databasePath, { readOnly: true });
  try {
    await backupNodeSqliteDatabase(db, `${candidate.databasePath}.claude-manual.${Date.now()}.bak`);
  } finally {
    db.close();
  }
}

/** Startup repair: migrate legacy slots and revisit unnamed Claude accounts after cooldown. */
export async function migrateLegacyClaudeProfilesAtStartup(config: BranchConfig): Promise<boolean> {
  const candidates = await listCandidateAuthProfileStores({ cfg: config });
  const stores = candidates.map((candidate) => ({
    candidate,
    store: loadCandidateAuthProfileStore(candidate),
  }));
  const identities = new Map<string, Awaited<ReturnType<typeof resolveAnthropicTokenIdentity>>>();
  for (const { store } of stores) {
    const credential = store?.profiles[LEGACY_ID];
    if (credential?.type !== "token" || !credential.token || identities.has(credential.token)) {
      continue;
    }
    const existingId = stores
      .flatMap(({ store: candidateStore }) => Object.entries(candidateStore?.profiles ?? {}))
      .find(
        ([id, candidate]) =>
          ID_PROFILE.test(id) &&
          candidate.type === "token" &&
          candidate.token === credential.token &&
          (candidate.identityLookupRetryAt ?? 0) > Date.now(),
      );
    identities.set(
      credential.token,
      credential.email
        ? {
            profileId: `anthropic:${credential.email.trim().toLowerCase()}`,
            email: credential.email.trim().toLowerCase(),
          }
        : existingId
          ? { profileId: existingId[0] }
          : await resolveAnthropicTokenIdentity(credential.token),
    );
  }
  if (!identities.size) {
    return promoteHashedClaudeProfiles(config, stores);
  }
  const primaryStore = stores.find(({ store }) => {
    const credential = store?.profiles[LEGACY_ID];
    if (credential?.type !== "token" || !credential.token) {
      return false;
    }
    const identity = identities.get(credential.token)!;
    const existing = store?.profiles[identity.profileId];
    return !existing || (existing.type === "token" && existing.token === credential.token);
  });
  if (!primaryStore) {
    return false;
  }
  const primaryCredential = primaryStore.store!.profiles[LEGACY_ID];
  if (primaryCredential?.type !== "token" || !primaryCredential.token) {
    return false;
  }
  const primary = identities.get(primaryCredential.token)!;
  const affected = stores
    .filter(
      ({ store }) =>
        store &&
        (store.profiles[LEGACY_ID] ||
          store.usageStats?.[LEGACY_ID] ||
          Object.values(store.order ?? {}).some((ids) => ids.includes(LEGACY_ID)) ||
          Object.values(store.lastGood ?? {}).includes(LEGACY_ID)),
    )
    .map(({ candidate, store }) => {
      const credential = store!.profiles[LEGACY_ID];
      const identity =
        credential?.type === "token" && credential.token
          ? identities.get(credential.token)
          : primary;
      if (!identity || (credential && credential.type !== "token")) {
        return null;
      }
      const existing = store!.profiles[identity.profileId];
      if (
        existing &&
        (existing.type !== "token" ||
          existing.token !==
            (credential?.type === "token" ? credential.token : primaryCredential.token))
      ) {
        return null;
      }
      return { candidate, identity };
    })
    .filter((entry) => entry !== null);
  // SQLite online backups capture WAL state, including each Trunk's local order.
  for (const { candidate } of affected) {
    await backupCandidate(candidate);
  }
  for (const { candidate, identity } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: identity.profileId,
      preserveProfileState: true,
      updater: (store) => {
        const copied = copyLegacyClaudeProfile(store, identity.profileId, identity.email);
        if (identity.lookupFailed) {
          const credential = store.profiles[identity.profileId];
          if (credential?.type === "token" && !credential.identityLookupRetryAt) {
            scheduleRetry(credential, identity.retryAfterMs);
            return true;
          }
        }
        return copied;
      },
    });
  }
  const nextConfig = migrateLegacyClaudeConfig(config, primary.profileId, primary.email);
  if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
    await writeConfigFile(nextConfig);
  }
  for (const { candidate, identity } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: identity.profileId,
      preserveProfileState: true,
      updater: (store) => {
        if (!store.profiles[identity.profileId] && store.profiles[LEGACY_ID]) {
          return false;
        }
        const hadLegacy = Boolean(store.profiles[LEGACY_ID] || store.usageStats?.[LEGACY_ID]);
        delete store.profiles[LEGACY_ID];
        if (store.usageStats) {
          delete store.usageStats[LEGACY_ID];
        }
        return hadLegacy;
      },
    });
  }
  return true;
}

async function promoteHashedClaudeProfiles(
  config: BranchConfig,
  stores: Array<{
    candidate: CandidateAuthProfileStore;
    store: ReturnType<typeof loadCandidateAuthProfileStore>;
  }>,
): Promise<boolean> {
  let changed = false;
  let currentConfig = config;
  const attemptedTokens = new Set<string>();
  for (const { store } of stores) {
    for (const [oldId, credential] of Object.entries(store?.profiles ?? {})) {
      if (
        !ID_PROFILE.test(oldId) ||
        credential.type !== "token" ||
        !credential.token ||
        attemptedTokens.has(credential.token)
      ) {
        continue;
      }
      attemptedTokens.add(credential.token);
      const owners = stores.filter(({ store: candidateStore }) => {
        const source = candidateStore?.profiles[oldId];
        return source?.type === "token" && source.token === credential.token;
      });
      if (
        owners.some(({ store: candidateStore }) => {
          const source = candidateStore?.profiles[oldId];
          return source?.type === "token" && (source.identityLookupRetryAt ?? 0) > Date.now();
        })
      ) {
        continue;
      }
      const identity = await resolveAnthropicTokenIdentity(credential.token);
      if (!identity.email) {
        for (const { candidate } of owners) {
          updateCandidateAuthProfileStore({
            candidate,
            profileId: oldId,
            updater: (target) => {
              const source = target.profiles[oldId];
              if (source?.type !== "token" || source.token !== credential.token) {
                return false;
              }
              scheduleRetry(source, identity.retryAfterMs);
              return true;
            },
          });
        }
        continue;
      }
      if (
        owners.some(({ store: candidateStore }) => {
          const existing = candidateStore?.profiles[identity.profileId];
          return existing && (existing.type !== "token" || existing.token !== credential.token);
        })
      ) {
        continue;
      }
      for (const { candidate } of owners) {
        await backupCandidate(candidate);
      }
      for (const { candidate } of owners) {
        updateCandidateAuthProfileStore({
          candidate,
          profileId: identity.profileId,
          preserveProfileState: true,
          updater: (target) => copyClaudeProfile(target, oldId, identity.profileId, identity.email),
        });
      }
      const nextConfig = migrateClaudeConfig(
        currentConfig,
        oldId,
        identity.profileId,
        identity.email,
      );
      if (JSON.stringify(nextConfig) !== JSON.stringify(currentConfig)) {
        await writeConfigFile(nextConfig);
        currentConfig = nextConfig;
      }
      for (const { candidate } of owners) {
        updateCandidateAuthProfileStore({
          candidate,
          profileId: identity.profileId,
          preserveProfileState: true,
          updater: (target) => {
            if (!target.profiles[identity.profileId]) {
              return false;
            }
            const hadOld = Boolean(target.profiles[oldId] || target.usageStats?.[oldId]);
            delete target.profiles[oldId];
            if (target.usageStats) {
              delete target.usageStats[oldId];
            }
            return hadOld;
          },
        });
      }
      changed = true;
    }
  }
  return changed;
}
