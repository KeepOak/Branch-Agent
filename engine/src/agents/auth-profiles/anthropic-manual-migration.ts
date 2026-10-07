import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeConfigFile } from "../../config/io.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { openNodeSqliteDatabase } from "../../infra/node-sqlite.js";
import { backupNodeSqliteDatabase } from "../../infra/sqlite-backup.js";
import { resolveAnthropicTokenIdentity, validateAnthropicSetupToken } from "../../plugins/provider-auth-token.js";
import { resolveSecretRefString } from "../../secrets/resolve.js";
import {
  copyClaudeProfile,
  copyLegacyClaudeProfile,
  LEGACY_CLAUDE_PROFILE_ID,
  migrateClaudeConfig,
  migrateLegacyClaudeConfig,
  sameClaudeTokenCredential,
} from "./anthropic-manual-migration-core.js";
import {
  listCandidateAuthProfileStores,
  loadCandidateAuthProfileStore,
  updateCandidateAuthProfileStore,
  type CandidateAuthProfileStore,
} from "./candidate-stores.js";
import type { AuthProfileCredential } from "./types.js";
const LEGACY_ID = LEGACY_CLAUDE_PROFILE_ID;
const ID_PROFILE = /^anthropic:id-[a-f0-9]{12}$/;
const BASE_RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 24 * 60 * 60_000;

async function resolveClaudeToken(
  credential: AuthProfileCredential | undefined,
  config: BranchConfig,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (credential?.type === "token") {
    return credential.token ?? (credential.tokenRef
      ? await resolveSecretRefString(credential.tokenRef, { config, env })
      : undefined);
  }
  if (credential?.type === "api_key") {
    const key = credential.key ?? (credential.keyRef
      ? await resolveSecretRefString(credential.keyRef, { config, env })
      : undefined);
    // Older Claude setup saved setup tokens as API keys. Do not rename ordinary
    // Anthropic API keys, which cannot identify a Claude subscription account.
    return key && !validateAnthropicSetupToken(key) ? key : undefined;
  }
  return undefined;
}

function isClaudeSecretCredential(
  credential: AuthProfileCredential | undefined,
): credential is Extract<AuthProfileCredential, { type: "token" | "api_key" }> {
  return credential?.type === "token" || credential?.type === "api_key";
}

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
  const legacyTokens = new Map<string, string>();
  for (const { candidate, store } of stores) {
    const credential = store?.profiles[LEGACY_ID];
    const token = await resolveClaudeToken(credential, config, candidate.env ?? process.env);
    if (!token || !isClaudeSecretCredential(credential)) {
      continue;
    }
    legacyTokens.set(candidate.databasePath, token);
    if (identities.has(token)) {
      continue;
    }
    const existingId = stores
      .flatMap(({ store: candidateStore }) => Object.entries(candidateStore?.profiles ?? {}))
      .find(
        ([id, profile]) =>
          ID_PROFILE.test(id) &&
          isClaudeSecretCredential(profile) &&
          (profile.type === "token" ? profile.token : profile.key) === token &&
          (profile.identityLookupRetryAt ?? 0) > Date.now(),
      );
    identities.set(
      token,
      credential.email
        ? {
            profileId: `anthropic:${credential.email.trim().toLowerCase()}`,
            email: credential.email.trim().toLowerCase(),
          }
        : existingId
          ? { profileId: existingId[0] }
          : await resolveAnthropicTokenIdentity(token),
    );
  }
  for (const [token, identity] of identities) {
    if (
      identity.email &&
      stores.some(({ candidate, store }) => {
        if (legacyTokens.get(candidate.databasePath) !== token) {
          return false;
        }
        const existing = store?.profiles[identity.profileId];
        const source = store?.profiles[LEGACY_ID];
        return Boolean(existing && source && !sameClaudeTokenCredential(existing, source));
      })
    ) {
      // A second token cannot take over an existing account slot. Give it its
      // own stable ID and retry promotion if that conflicting slot goes away.
      identities.set(token, {
        ...identity,
        profileId: `anthropic:id-${createHash("sha256").update(token).digest("hex").slice(0, 12)}`,
        lookupFailed: true,
      });
    }
  }
  if (!identities.size) {
    return promoteHashedClaudeProfiles(config, stores);
  }
  const primaryStore = stores.find(({ candidate, store }) => {
    const credential = store?.profiles[LEGACY_ID];
    const token = legacyTokens.get(candidate.databasePath);
    if (!isClaudeSecretCredential(credential) || !token) {
      return false;
    }
    const identity = identities.get(token)!;
    const existing = store?.profiles[identity.profileId];
    return !existing || sameClaudeTokenCredential(existing, credential);
  });
  if (!primaryStore) {
    return false;
  }
  const primaryCredential = primaryStore.store!.profiles[LEGACY_ID];
  const primaryToken = legacyTokens.get(primaryStore.candidate.databasePath);
  if (!isClaudeSecretCredential(primaryCredential) || !primaryToken) {
    return false;
  }
  const primary = identities.get(primaryToken)!;
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
        isClaudeSecretCredential(credential) && legacyTokens.has(candidate.databasePath)
          ? identities.get(legacyTokens.get(candidate.databasePath)!)
          : primary;
      if (!identity || (credential && !isClaudeSecretCredential(credential))) {
        return null;
      }
      const existing = store!.profiles[identity.profileId];
      if (
        existing &&
        !sameClaudeTokenCredential(existing, credential ?? primaryCredential)
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
          if (isClaudeSecretCredential(credential) && !credential.identityLookupRetryAt) {
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
  for (const { candidate: sourceCandidate, store } of stores) {
    for (const [oldId, credential] of Object.entries(store?.profiles ?? {})) {
      if (
        !ID_PROFILE.test(oldId) ||
        !isClaudeSecretCredential(credential) ||
        (credential.type === "token"
          ? !credential.token && !credential.tokenRef
          : !credential.key && !credential.keyRef)
      ) {
        continue;
      }
      const token = await resolveClaudeToken(
        credential,
        currentConfig,
        sourceCandidate.env ?? process.env,
      );
      if (!token || attemptedTokens.has(token)) {
        continue;
      }
      attemptedTokens.add(token);
      const owners = stores.filter(({ store: candidateStore }) => {
        const source = candidateStore?.profiles[oldId];
        return source && sameClaudeTokenCredential(source, credential);
      });
      if (
        owners.some(({ store: candidateStore }) => {
          const source = candidateStore?.profiles[oldId];
          return isClaudeSecretCredential(source) && (source.identityLookupRetryAt ?? 0) > Date.now();
        })
      ) {
        continue;
      }
      const identity = await resolveAnthropicTokenIdentity(token);
      if (!identity.email) {
        for (const { candidate } of owners) {
          updateCandidateAuthProfileStore({
            candidate,
            profileId: oldId,
            updater: (target) => {
              const source = target.profiles[oldId];
              if (!isClaudeSecretCredential(source) || !sameClaudeTokenCredential(source, credential)) {
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
          return existing && !sameClaudeTokenCredential(existing, credential);
        })
      ) {
        for (const { candidate } of owners) {
          updateCandidateAuthProfileStore({
            candidate,
            profileId: oldId,
            updater: (target) => {
              const source = target.profiles[oldId];
              if (!isClaudeSecretCredential(source) || !sameClaudeTokenCredential(source, credential)) {
                return false;
              }
              scheduleRetry(source);
              return true;
            },
          });
        }
        continue;
      }
      const affected = stores.filter(({ store: candidateStore }) => {
        if (!candidateStore) {
          return false;
        }
        const source = candidateStore.profiles[oldId];
        const existing = candidateStore.profiles[identity.profileId];
        if (
          (source && !sameClaudeTokenCredential(source, credential)) ||
          (existing && !sameClaudeTokenCredential(existing, source ?? credential))
        ) {
          return false;
        }
        return Boolean(
          source ||
            candidateStore.usageStats?.[oldId] ||
            Object.values(candidateStore.order ?? {}).some((ids) => ids.includes(oldId)) ||
            Object.values(candidateStore.lastGood ?? {}).includes(oldId),
        );
      });
      for (const { candidate } of affected) {
        await backupCandidate(candidate);
      }
      for (const { candidate } of affected) {
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
      for (const { candidate } of affected) {
        updateCandidateAuthProfileStore({
          candidate,
          profileId: identity.profileId,
          preserveProfileState: true,
          updater: (target) => {
            if (!target.profiles[identity.profileId] && target.profiles[oldId]) {
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
