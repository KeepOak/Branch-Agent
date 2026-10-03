import { coerceErrorMessage } from "@branch/normalization-core";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import {
  GROVE_CRON_REF_SCHEMA_VERSION,
  groveCronGatewayJobMatchesRef,
  groveCronGatewayInput,
  groveCronSchedulerJobFromResult,
  deleteGroveCronRef,
  readGroveCronRefs,
  upsertGroveCronRef,
  type GroveCronGateway,
  type PersistedGroveCronRef,
} from "./cron.js";
import { digestGroveValue as digest } from "./digest.js";
import type { GroveCronJob, GroveManifest } from "./types.js";
import type { GroveUpdatePlan } from "./update-plan.js";
import { collectGroveRollbackFailures } from "./update-rollback.js";

export type GroveCronUpdateExecution = {
  appliedIds: string[];
  rollback: () => Promise<void>;
};

export class GroveCronUpdateError extends Error {
  constructor(
    message: string,
    readonly partial = false,
  ) {
    super(message);
    this.name = "GroveCronUpdateError";
  }
}

function targetRef(params: {
  agentId: string;
  job: GroveCronJob;
  previous?: PersistedGroveCronRef;
  nowMs: number;
}): PersistedGroveCronRef {
  return {
    schemaVersion: GROVE_CRON_REF_SCHEMA_VERSION,
    agentId: params.agentId,
    manifestId: params.job.id,
    declarationKey: `grove:${params.agentId}:${params.job.id}`,
    status: "pending",
    job: params.job,
    createdAtMs: params.previous?.createdAtMs ?? params.nowMs,
    updatedAtMs: params.nowMs,
  };
}

export async function applyGroveCronUpdate(
  updatePlan: GroveUpdatePlan,
  targetManifest: GroveManifest,
  options: BranchStateDatabaseOptions & {
    cronGateway?: GroveCronGateway;
    nowMs?: number;
    readRefs?: typeof readGroveCronRefs;
    upsertRef?: typeof upsertGroveCronRef;
    deleteRef?: typeof deleteGroveCronRef;
  },
): Promise<GroveCronUpdateExecution> {
  const actions = updatePlan.actions.filter(
    (action) => action.kind === "cronJob" && action.action !== "unchanged",
  );
  if (actions.length === 0) {
    return { appliedIds: [], rollback: async () => undefined };
  }
  if (!options.cronGateway) {
    throw new GroveCronUpdateError("Grove cron updates require the gateway cron API.");
  }
  if (!options.cronGateway.get) {
    throw new GroveCronUpdateError("Grove cron updates require the gateway cron.get API.");
  }
  const gateway = options.cronGateway;
  const readRefs = options.readRefs ?? readGroveCronRefs;
  const upsertRef = options.upsertRef ?? upsertGroveCronRef;
  const deleteRef = options.deleteRef ?? deleteGroveCronRef;
  const currentRefs = new Map(
    readRefs(updatePlan.agentId, options).map((ref) => [ref.manifestId, ref]),
  );
  const targetJobs = new Map(targetManifest.cronJobs.map((job) => [job.id, job]));
  const undo: Array<() => Promise<void>> = [];
  const appliedIds: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  let agentAvailable = false;

  const waitForAgent = async () => {
    if (!agentAvailable) {
      await gateway.waitUntilAgentAvailable?.(updatePlan.agentId);
      agentAvailable = true;
    }
  };
  const add = async (ref: PersistedGroveCronRef): Promise<string> => {
    await waitForAgent();
    let raw: unknown;
    try {
      raw = await gateway.add(groveCronGatewayInput(updatePlan.agentId, ref));
    } catch (error) {
      throw new GroveCronUpdateError(coerceErrorMessage(error), true);
    }
    const result = groveCronSchedulerJobFromResult(raw);
    if (!result) {
      throw new GroveCronUpdateError("cron.add returned no scheduler job id.", true);
    }
    return result.id;
  };
  const rollback = async () => {
    const failures = await collectGroveRollbackFailures(undo.toReversed());
    if (failures.length > 0) {
      throw new GroveCronUpdateError(failures.join("; "));
    }
  };

  try {
    for (const action of actions) {
      const previous = currentRefs.get(action.id);
      if (previous && action.currentDigest && digest(previous.job) !== action.currentDigest) {
        throw new GroveCronUpdateError(
          `Cron declaration ${JSON.stringify(action.id)} changed after planning.`,
        );
      }
      if (previous?.schedulerJobId) {
        const live = await gateway.get!(previous.schedulerJobId);
        if (!groveCronGatewayJobMatchesRef(updatePlan.agentId, previous, live)) {
          throw new GroveCronUpdateError(
            `Cron declaration ${JSON.stringify(action.id)} changed after planning.`,
          );
        }
      }
      if (action.action === "remove") {
        if (!previous?.schedulerJobId || previous.status !== "complete") {
          throw new GroveCronUpdateError(
            `Cron declaration ${JSON.stringify(action.id)} is no longer safely removable.`,
          );
        }
        upsertRef({ ...previous, status: "pending", updatedAtMs: nowMs }, options);
        try {
          await gateway.remove(previous.schedulerJobId);
        } catch (error) {
          throw new GroveCronUpdateError(coerceErrorMessage(error), true);
        }
        undo.push(async () => {
          const restoredId = await add(previous);
          upsertRef({ ...previous, schedulerJobId: restoredId, updatedAtMs: nowMs }, options);
        });
        deleteRef(updatePlan.agentId, action.id, options);
        appliedIds.push(action.id);
        continue;
      }

      const job = targetJobs.get(action.id);
      if (!job) {
        throw new GroveCronUpdateError(
          `Target cron declaration ${JSON.stringify(action.id)} is missing.`,
        );
      }
      // A readiness failure must leave this declaration's ownership untouched.
      await waitForAgent();
      const pending = targetRef({ agentId: updatePlan.agentId, job, previous, nowMs });
      upsertRef(pending, options);
      const schedulerJobId = await add(pending);
      if (action.action === "change") {
        if (!previous?.schedulerJobId || schedulerJobId !== previous.schedulerJobId) {
          try {
            await gateway.remove(schedulerJobId);
            if (previous) {
              upsertRef(previous, options);
            }
          } catch (error) {
            throw new GroveCronUpdateError(
              `cron.add did not converge and cleanup failed: ${coerceErrorMessage(error)}`,
              true,
            );
          }
          throw new GroveCronUpdateError(
            `cron.add did not converge declaration ${JSON.stringify(action.id)} on its owned scheduler job.`,
          );
        }
        undo.push(async () => {
          const restoredId = await add(previous);
          upsertRef({ ...previous, schedulerJobId: restoredId, updatedAtMs: nowMs }, options);
        });
      } else {
        undo.push(async () => {
          await gateway.remove(schedulerJobId);
          deleteRef(updatePlan.agentId, action.id, options);
        });
      }
      upsertRef({ ...pending, schedulerJobId, status: "complete" }, options);
      appliedIds.push(action.id);
    }
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new GroveCronUpdateError(
        `${coerceErrorMessage(error)}; rollback failed: ${coerceErrorMessage(rollbackError)}`,
        true,
      );
    }
    throw new GroveCronUpdateError(
      coerceErrorMessage(error),
      error instanceof GroveCronUpdateError && error.partial,
    );
  }
  return { appliedIds, rollback };
}
