import type { SessionStartupMigrationLogger } from "../config/sessions/startup-migration.js";
import type { BranchConfig } from "../config/types.branch.js";

/**
 * Update canary half of startup session maintenance: the copied agent databases go through the same
 * schema, ACP and canonical session validation a serving start runs before readiness. It never hands a
 * database to the runtime (no orphan recovery or transcript reconcile), because nothing may resume work
 * from a private copy. A row a real start would refuse ("invalid persisted session row requires repair")
 * rejects here, so the candidate fails while the serving Gateway is untouched.
 */
export async function runUpdateCanarySessionValidation(params: {
  cfg: BranchConfig;
  env?: NodeJS.ProcessEnv;
  log: SessionStartupMigrationLogger;
}): Promise<void> {
  const { runSessionStartupMigration } = await import("../config/sessions/startup-migration.js");
  await runSessionStartupMigration({ cfg: params.cfg, env: params.env, log: params.log });
}
