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
  const owned = stores.find(({ store }) => store?.profiles[LEGACY_ID]?.type === "token");
  const credential = owned?.store?.profiles[LEGACY_ID];
  if (!credential || credential.type !== "token" || !credential.token) return false;
  const identity = credential.email
    ? { profileId: `anthropic:${credential.email.trim().toLowerCase()}`, email: credential.email.trim().toLowerCase() }
    : await resolveAnthropicTokenIdentity(credential.token);
  if (!identity.email) return false;
  const email = identity.email;
  const nextId = identity.profileId;
  if (stores.some(({ store }) => store?.profiles[nextId] && store.profiles[nextId]?.type === "token" && store.profiles[nextId]?.token !== credential.token)) {
    return false;
  }
  const affected = stores.filter(({ store }) => store && (
    store.profiles[LEGACY_ID] || store.usageStats?.[LEGACY_ID] ||
    Object.values(store.order ?? {}).some((ids) => ids.includes(LEGACY_ID)) ||
    Object.values(store.lastGood ?? {}).includes(LEGACY_ID)
  ));
  // SQLite online backups capture WAL state, including each Trunk's local order.
  for (const { candidate } of affected) await backupCandidate(candidate);
  for (const { candidate } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: nextId,
      preserveProfileState: true,
      updater: (store) => copyLegacyClaudeProfile(store, nextId, email),
    });
  }
  const nextConfig = migrateLegacyClaudeConfig(config, nextId, email);
  if (JSON.stringify(nextConfig) !== JSON.stringify(config)) await writeConfigFile(nextConfig);
  for (const { candidate } of affected) {
    updateCandidateAuthProfileStore({
      candidate,
      profileId: nextId,
      preserveProfileState: true,
      updater: (store) => {
        if (!store.profiles[nextId] && store.profiles[LEGACY_ID]) return false;
        const hadLegacy = Boolean(store.profiles[LEGACY_ID] || store.usageStats?.[LEGACY_ID]);
        delete store.profiles[LEGACY_ID];
        if (store.usageStats) delete store.usageStats[LEGACY_ID];
        return hadLegacy;
      },
    });
  }
  return true;
}
