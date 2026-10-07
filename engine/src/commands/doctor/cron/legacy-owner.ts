import { safeParseJsonRecord } from "@branch/normalization-core/json-coercion";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { listAgentEntries } from "../../../agents/agent-scope-config.js";
import { createCronOwnerWriteRefusalError } from "../../../config/io.cron-owner-refusal.js";
import { resolveLegacyAgentRosterOwner } from "../../../config/legacy.roster.js";
import type { ConfigFileSnapshot, BranchConfig } from "../../../config/types.js";
import { tryResolveCronJobEffectiveAgentId } from "../../../cron/agent-id.js";
import { resolveCronJobsStorePathFromConfig } from "../../../cron/store/paths.js";
import { normalizeAgentId } from "../../../routing/session-key.js";
import { getBranchDatabaseMaintenanceScope } from "../../../state/branch-state-db-async-lifecycle.js";
import { resolveBranchStateSqlitePath } from "../../../state/branch-state-db.paths.js";
import { loadLegacyCronRepairState } from "./legacy-repair.js";
import { repairLegacyCronJobOwnersForDoctor } from "./store-repair.js";

/** Runs under Doctor's config lock before retiring the source roster's owner marker. */
export async function repairLegacyCronOwnersBeforeConfigWrite(params: {
  snapshot: ConfigFileSnapshot;
  nextConfig: BranchConfig;
  env?: NodeJS.ProcessEnv;
  assertCurrent?: () => void;
}): Promise<string[]> {
  const env = params.env ?? process.env;
  const source = params.snapshot.sourceConfigBeforeMigrations ?? params.snapshot.sourceConfig;
  const legacyOwner = [params.snapshot.sourceConfigBeforeMigrations, params.snapshot.parsed]
    .map(resolveLegacyAgentRosterOwner)
    .find((owner) => owner !== undefined);
  if (!legacyOwner) {
    return [];
  }
  params.assertCurrent?.();
  const storePath = resolveCronJobsStorePathFromConfig(source, env);
  const state = await loadLegacyCronRepairState({
    cfg: params.snapshot.config,
    storePath,
    env,
    readOnly: true,
  });
  params.assertCurrent?.();
  const hasExplicitOwner = (job: Record<string, unknown> | undefined) =>
    tryResolveCronJobEffectiveAgentId({
      agentId: normalizeOptionalString(job?.agentId),
      sessionKey: normalizeOptionalString(job?.sessionKey),
    });
  const ownerless =
    state?.rawJobs.some((job) => !hasExplicitOwner(job)) ||
    state?.ownerRows.some((row) => !hasExplicitOwner(safeParseJsonRecord(row.job_json)));
  if (!ownerless) {
    return [];
  }
  if (
    !listAgentEntries(params.nextConfig).some(
      (entry) => normalizeAgentId(entry.id) === normalizeAgentId(legacyOwner),
    )
  ) {
    throw createCronOwnerWriteRefusalError(
      `Doctor cannot retire legacy cron owner ${legacyOwner} while its jobs are unassigned. Preserve that agent and rerun "branch doctor --fix" first.`,
    );
  }
  const maintenance = getBranchDatabaseMaintenanceScope();
  if (!maintenance?.ownsSchemaMaintenance) {
    throw createCronOwnerWriteRefusalError(
      'Cron ownership repair requires Doctor maintenance. Run "branch doctor --fix" before retrying the config write.',
    );
  }
  const assertCurrent = () => {
    params.assertCurrent?.();
    maintenance.assertDatabaseAccess(resolveBranchStateSqlitePath(env));
  };
  const result = await repairLegacyCronJobOwnersForDoctor(
    { env },
    { assertCurrent, assertOwnedInTransaction: assertCurrent },
    storePath,
    legacyOwner,
  );
  assertCurrent();
  return result.changed > 0
    ? [
        `Preserved ownership for ${result.changed} legacy cron job(s); unassigned jobs retain ${legacyOwner}.`,
        `Saved pre-repair cron backup: ${result.backupPath}`,
      ]
    : [];
}
