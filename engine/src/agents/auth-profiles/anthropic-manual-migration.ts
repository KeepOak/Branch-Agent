import fs from "node:fs/promises";
import { openNodeSqliteDatabase } from "../../infra/node-sqlite.js";
import { backupNodeSqliteDatabase } from "../../infra/sqlite-backup.js";
import { writeConfigFile } from "../../config/io.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { resolveAnthropicTokenIdentity } from "../../plugins/provider-auth-token.js";
import { copyLegacyClaudeProfile, LEGACY_CLAUDE_PROFILE_ID, migrateLegacyClaudeConfig } from "./anthropic-manual-migration-core.js";
import {
  listCandidateAuthProfileStores,
  loadCandidateAuthProfileStore,
  updateCandidateAuthProfileStore,
  type CandidateAuthProfileStore,
} from "./candidate-stores.js";
const LEGACY_ID = LEGACY_CLAUDE_PROFILE_ID;

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

/** Startup repair: no network or writes unless an owned legacy credential exists. */
export async function migrateLegacyClaudeProfilesAtStartup(config: BranchConfig): Promise<boolean> {
  const candidates = await listCandidateAuthProfileStores({ cfg: config });
  const stores = candidates.map((candidate) => ({ candidate, store: loadCandidateAuthProfileStore(candidate) }));
  const identities = new Map<string, Awaited<ReturnType<typeof resolveAnthropicTokenIdentity>>>();
  for (const { store } of stores) {
    const credential = store?.profiles[LEGACY_ID];
    if (credential?.type !== "token" || !credential.token || identities.has(credential.token)) continue;
    identities.set(credential.token, credential.email
      ? { profileId: `anthropic:${credential.email.trim().toLowerCase()}`, email: credential.email.trim().toLowerCase() }
      : await resolveAnthropicTokenIdentity(credential.token));
  }
  if (!identities.size) return false;
  const primaryStore = stores.find(({ store }) => {
    const credential = store?.profiles[LEGACY_ID];
    if (credential?.type !== "token" || !credential.token) return false;
    const identity = identities.get(credential.token)!;
    const existing = store?.profiles[identity.profileId];
    return !existing || (existing.type === "token" && existing.token === credential.token);
  });
  if (!primaryStore) return false;
  const primaryCredential = primaryStore.store!.profiles[LEGACY_ID];
  if (primaryCredential?.type !== "token" || !primaryCredential.token) return false;
  const primary = identities.get(primaryCredential.token)!;
  const affected = stores.filter(({ store }) => store && (
    store.profiles[LEGACY_ID] || store.usageStats?.[LEGACY_ID] ||
    Object.values(store.order ?? {}).some((ids) => ids.includes(LEGACY_ID)) ||
    Object.values(store.lastGood ?? {}).includes(LEGACY_ID)
  )).map(({ candidate, store }) => {
    const credential = store!.profiles[LEGACY_ID];
    const identity = credential?.type === "token" && credential.token
      ? identities.get(credential.token)
      : primary;
    if (!identity || (credential && credential.type !== "token")) return null;
    const existing = store!.profiles[identity.profileId];
    if (existing && (existing.type !== "token" || existing.token !== (credential?.type === "token" ? credential.token : primaryCredential.token))) return null;
    return { candidate, identity };
  }).filter((entry) => entry !== null);
  // SQLite online backups capture WAL state, including each Trunk's local order.
  for (const { candidate } of affected) await backupCandidate(candidate);
  for (const { candidate, identity } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: identity.profileId,
      preserveProfileState: true,
      updater: (store) => copyLegacyClaudeProfile(store, identity.profileId, identity.email),
    });
  }
  const nextConfig = migrateLegacyClaudeConfig(config, primary.profileId, primary.email);
  if (JSON.stringify(nextConfig) !== JSON.stringify(config)) await writeConfigFile(nextConfig);
  for (const { candidate, identity } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: identity.profileId,
      preserveProfileState: true,
      updater: (store) => {
        if (!store.profiles[identity.profileId] && store.profiles[LEGACY_ID]) return false;
        const hadLegacy = Boolean(store.profiles[LEGACY_ID] || store.usageStats?.[LEGACY_ID]);
        delete store.profiles[LEGACY_ID];
        if (store.usageStats) delete store.usageStats[LEGACY_ID];
        return hadLegacy;
      },
    });
  }
  return true;
}
