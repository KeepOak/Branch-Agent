/** Database-backed per-job scratch storage, kept outside public cron job state. */
import { createHash } from "node:crypto";
import { executeSqliteQuerySync } from "../infra/kysely-sync.js";
import { withExistingBranchStateDatabaseReadOnly } from "../state/branch-state-db-readonly.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { captureCronMutationCommit } from "./mutation-completion.js";
import {
  assertCronJobScratchContent,
  type CronJobScratchState,
  type CronJobScratchWriteResult,
} from "./scratch-contract.js";
import {
  readHeartbeatMonitorScratchFromDatabase,
  readScratchStateFromDatabase,
} from "./scratch-read.kernel.js";
import { runCronRuntimeMutation } from "./service/runtime-mutation.js";
import { cronStoreKey } from "./store/key.js";
import { getCronStoreKysely } from "./store/schema.js";

/** Doctor's synchronous transaction reads stay with the maintenance owner. */
export function readCronJobScratchState(
  storePath: string,
  jobId: string,
  options: BranchStateDatabaseOptions = {},
): CronJobScratchState {
  const { db } = openBranchStateDatabase(options);
  return readScratchStateFromDatabase(db, cronStoreKey(storePath), jobId);
}

export function readHeartbeatMonitorScratch(
  storePath: string,
  agentId: string,
  options: BranchStateDatabaseOptions = {},
) {
  const { db } = openBranchStateDatabase(options);
  return readHeartbeatMonitorScratchFromDatabase(db, cronStoreKey(storePath), agentId);
}

/** Doctor inventory does not create or migrate its inspected source. */
export function readHeartbeatMonitorScratchReadOnly(
  storePath: string,
  agentId: string,
  options: BranchStateDatabaseOptions = {},
) {
  return withExistingBranchStateDatabaseReadOnly(
    ({ db }) => readHeartbeatMonitorScratchFromDatabase(db, cronStoreKey(storePath), agentId),
    options,
  );
}

/** Writes through the existing actor while retaining the original caller's admission. */
export async function writeCronJobScratch(
  params: {
    storePath: string;
    jobId: string;
    content: string | null;
    expectedRevision?: number;
    sourceSha256?: string;
    nowMs?: number;
    options?: Pick<BranchStateDatabaseOptions, "path" | "env">;
  },
  admission?: {
    context?: BranchStateWorkerContext;
    assertCurrent?: () => void;
    assertJobCurrent?: (configRevision: string | undefined) => void;
    createdAtMsFallback?: number;
  },
): Promise<CronJobScratchWriteResult> {
  if (params.content !== null) {
    assertCronJobScratchContent(params.content);
  }
  const context = admission?.context ?? captureBranchStateWorkerContext(params.options);
  const markCommitted = captureCronMutationCommit("cron.scratch.set");
  let result: CronJobScratchWriteResult | undefined;
  await runCronRuntimeMutation({
    context,
    type: "cron.writeScratch",
    input: {
      storeKey: cronStoreKey(params.storePath),
      jobId: params.jobId,
      content: params.content,
      expectedRevision: params.expectedRevision,
      sourceSha256: params.sourceSha256,
      nowMs: params.nowMs ?? Date.now(),
      createdAtMsFallback: admission?.createdAtMsFallback,
    },
    assertCurrent: () => admission?.assertCurrent?.(),
    prepare({ configRevision }) {
      const assertCurrent = () => {
        admission?.assertCurrent?.();
        admission?.assertJobCurrent?.(configRevision);
      };
      assertCurrent();
      return { value: {}, assertCurrent };
    },
    publish(outcome) {
      result = outcome.result;
      if (outcome.written) {
        markCommitted?.();
      }
    },
  });
  if (!result) {
    throw new Error("Cron scratch write has no committed result");
  }
  return result;
}

/**
 * Deletes scratch when its owning job is removed, or — with expectedRevision —
 * atomically reverts a migration write back to the no-row state. Returns false
 * when the guarded revision moved.
 */
export function deleteCronJobScratch(
  storePath: string,
  jobId: string,
  options: BranchStateDatabaseOptions = {},
  guard?: { expectedRevision: number },
): boolean {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const storeKey = cronStoreKey(storePath);
      const cronDb = getCronStoreKysely(db);
      if (guard) {
        const row = executeSqliteQuerySync(
          db,
          cronDb
            .selectFrom("cron_job_scratch")
            .select(["revision", "updated_at_ms"])
            .where("store_key", "=", storeKey)
            .where("job_id", "=", jobId),
        ).rows[0];
        const currentRevision = row?.revision ?? 0;
        if (currentRevision !== guard.expectedRevision) {
          return false;
        }
      }
      executeSqliteQuerySync(
        db,
        cronDb
          .deleteFrom("cron_job_scratch")
          .where("store_key", "=", storeKey)
          .where("job_id", "=", jobId),
      );
      return true;
    },
    options,
    { operationLabel: "cron.scratch.delete" },
  );
}

/** Hash used by doctor to prove the file it removes is the file it migrated. */
export function hashCronScratchSource(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
