import {
  ErrorCodes,
  errorShape,
  type BackupRunResult,
  type BackupScheduleSetResult,
  type BackupStatusResult,
  validateBackupRunParams,
  validateBackupScheduleClearParams,
  validateBackupScheduleSetParams,
  validateBackupStatusParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { prepareBackupDestination, readBackupRemote } from "../../commands/backup-destination.js";
import { resolveStateDir } from "../../config/paths.js";
import {
  backupScheduleModeForDeclaration,
  buildBackupScheduleJob,
  summarizeBackupSchedules,
} from "../../cron/backup-command.js";
import type { CronJob } from "../../cron/types.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { getLoadedRuntimePluginRegistry } from "../../plugins/active-runtime-registry.js";
import { readBackupRuns, summarizeBackupTargets } from "../../state/backup-run-records.js";
import { listStorageLocations } from "../../storage/locations.js";
import type { GatewayRequestHandlers } from "./types.js";
import { defineValidatedGatewayMethod } from "./validation.js";

function gitScheduleJobs(jobs: readonly CronJob[]): CronJob[] {
  return jobs.filter((job) => backupScheduleModeForDeclaration(job.declarationKey) === "git");
}

/** Git schedules that push also report the repository address they push to (never a sign-in). */
async function withRemotes(
  schedules: BackupStatusResult["schedules"],
): Promise<BackupStatusResult["schedules"]> {
  return await Promise.all(
    schedules.map(async (schedule) => {
      if (schedule.mode !== "git" || !schedule.push) {
        return schedule;
      }
      const remote = await readBackupRemote(schedule.target).catch(() => undefined);
      return remote ? { ...schedule, remote } : schedule;
    }),
  );
}

export const backupHandlers: GatewayRequestHandlers = {
  "backup.status": defineValidatedGatewayMethod(
    "backup.status",
    validateBackupStatusParams,
    async ({ context, respond }) => {
      const [runs, jobs] = await Promise.all([
        readBackupRuns(process.env),
        context.cron.list({ includeDisabled: true }),
      ]);
      const result: BackupStatusResult = {
        targets: summarizeBackupTargets(runs),
        schedules: await withRemotes(summarizeBackupSchedules(jobs)),
        locations: listStorageLocations(
          context.getRuntimeConfig(),
          getLoadedRuntimePluginRegistry() ?? undefined,
        ),
      };
      respond(true, result, undefined);
    },
  ),
  // Branch Settings › Backups: one Git schedule that always omits secrets and includes the
  // redacted config and workspace files. "Off" keeps the job disabled so the destination stays.
  "backup.schedule.set": defineValidatedGatewayMethod(
    "backup.schedule.set",
    validateBackupScheduleSetParams,
    async ({ params, context, respond }) => {
      let prepared: Awaited<ReturnType<typeof prepareBackupDestination>>;
      try {
        prepared = await prepareBackupDestination(params.destination, resolveStateDir());
      } catch (error) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatErrorMessage(error)));
        return;
      }
      const job = buildBackupScheduleJob({
        mode: "git",
        everyMs: params.everyMs,
        repository: prepared.repository,
        scope: { kind: "all" },
        push: prepared.push,
        excludeSecrets: true,
        files: true,
      });
      const added = await context.cron.add(
        { ...job, enabled: params.enabled },
        { enabledExplicit: true },
      );
      const stored = "job" in added ? added.job : added;
      const result: BackupScheduleSetResult = {
        id: stored.id,
        repository: prepared.repository,
        push: prepared.push,
        enabled: stored.enabled,
        everyMs: params.everyMs,
      };
      respond(true, result, undefined);
    },
  ),
  "backup.schedule.clear": defineValidatedGatewayMethod(
    "backup.schedule.clear",
    validateBackupScheduleClearParams,
    async ({ context, respond }) => {
      const jobs = gitScheduleJobs(await context.cron.list({ includeDisabled: true }));
      for (const job of jobs) {
        await context.cron.remove(job.id);
      }
      respond(true, { removed: jobs.length > 0 }, undefined);
    },
  ),
  // "Back up now" runs the stored schedule through cron (also when it is off), so it gets the
  // same command, the same one-run-at-a-time guard and an entry in the automation's history.
  "backup.run": defineValidatedGatewayMethod(
    "backup.run",
    validateBackupRunParams,
    async ({ context, respond }) => {
      const [job] = gitScheduleJobs(await context.cron.list({ includeDisabled: true }));
      if (!job) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Choose where backups go first."),
        );
        return;
      }
      const run = await context.cron.enqueueRun(job.id, "force");
      const result: BackupRunResult = {
        jobId: job.id,
        started: run.ok && ("enqueued" in run || ("ran" in run && run.ran)),
        ...(run.ok && "reason" in run ? { reason: run.reason } : {}),
      };
      respond(true, result, undefined);
    },
  ),
};
