import type { SQLInputValue } from "node:sqlite";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import type { Selectable } from "kysely";
import { resolveCronJobConfigRevision } from "../cron/config-revision.js";
import { cronJobDefinitionFromReadView } from "../cron/job-read-view.js";
import { normalizeCronJobCreate } from "../cron/normalize.js";
import { createTrustedCronScheduledToolPolicy } from "../cron/scheduled-tool-policy.js";
import { applyDefaultCronToolsAllow } from "../cron/tools-allow.js";
import type { CronJob } from "../cron/types.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { coerceRequiredSqliteNumber as sqliteNumber } from "../infra/sqlite-number.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import type { GroveAddPlan, GroveCronJob } from "./types.js";

export const GROVE_CRON_REF_SCHEMA_VERSION = "branch.groveCronRef.v1" as const;

export type PersistedGroveCronRef = {
  schemaVersion: typeof GROVE_CRON_REF_SCHEMA_VERSION;
  agentId: string;
  manifestId: string;
  declarationKey: string;
  schedulerJobId?: string;
  status: "pending" | "complete" | "failed" | "removed";
  job: GroveCronJob;
  error?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type CronRefDatabase = Pick<DB, "grove_cron_refs">;
type CronRefRow = Selectable<CronRefDatabase["grove_cron_refs"]>;

export type GroveCronGateway = {
  add: (input: Record<string, unknown>) => Promise<unknown>;
  get?: (schedulerJobId: string) => Promise<unknown>;
  list?: (agentId: string) => Promise<unknown>;
  remove: (schedulerJobId: string) => Promise<unknown>;
  waitUntilAgentAvailable?: (agentId: string) => Promise<void>;
};

export class GroveCronInstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cronJobs: PersistedGroveCronRef[],
  ) {
    super(message);
    this.name = "GroveCronInstallError";
  }
}

function rowToRef(row: CronRefRow): PersistedGroveCronRef {
  return {
    schemaVersion: GROVE_CRON_REF_SCHEMA_VERSION,
    agentId: row.agent_id,
    manifestId: row.manifest_id,
    declarationKey: row.declaration_key,
    ...(row.scheduler_job_id ? { schedulerJobId: row.scheduler_job_id } : {}),
    // SAFETY: Lifecycle writers own the existing persisted status enum.
    status: row.status as PersistedGroveCronRef["status"],
    job: JSON.parse(row.job_json) as GroveCronJob,
    ...(row.error ? { error: row.error } : {}),
    createdAtMs: sqliteNumber(row.created_at_ms),
    updatedAtMs: sqliteNumber(row.updated_at_ms),
  };
}

function refToRow(ref: PersistedGroveCronRef): CronRefRow {
  return {
    schema_version: ref.schemaVersion,
    agent_id: ref.agentId,
    manifest_id: ref.manifestId,
    declaration_key: ref.declarationKey,
    scheduler_job_id: ref.schedulerJobId ?? null,
    status: ref.status,
    job_json: JSON.stringify(ref.job),
    error: ref.error ?? null,
    created_at_ms: ref.createdAtMs,
    updated_at_ms: ref.updatedAtMs,
  };
}

function persistPendingRef(
  plan: GroveAddPlan,
  job: GroveCronJob,
  options: BranchStateDatabaseOptions & { nowMs?: number },
): PersistedGroveCronRef {
  const nowMs = options.nowMs ?? Date.now();
  const declarationKey = `grove:${plan.agent.finalId}:${job.id}`;
  const database = openBranchStateDatabase(options);
  const query = getNodeSqliteKysely<CronRefDatabase>(database.db)
    .selectFrom("grove_cron_refs")
    .selectAll()
    .where("agent_id", "=", plan.agent.finalId)
    .where("manifest_id", "=", job.id)
    .compile();
  const existing =
    database.db /* sqlite-allow-raw: execute compiled Kysely with the existing native read error boundary. */
      .prepare(query.sql)
      // SAFETY: Compiled predicates bind strings; the canonical schema supplies the row shape.
      .get(...(query.parameters as SQLInputValue[])) as CronRefRow | undefined;
  if (existing) {
    const ref = rowToRef(existing);
    if (ref.declarationKey !== declarationKey || JSON.stringify(ref.job) !== JSON.stringify(job)) {
      throw new GroveCronInstallError(
        "cron_provenance_conflict",
        `Cron declaration ${JSON.stringify(job.id)} differs from its pending ownership record.`,
        [ref],
      );
    }
    if (ref.status === "complete") {
      return ref;
    }
    return updateRef(ref, { status: "pending" }, options);
  }
  const record: PersistedGroveCronRef = {
    schemaVersion: GROVE_CRON_REF_SCHEMA_VERSION,
    agentId: plan.agent.finalId,
    manifestId: job.id,
    declarationKey,
    status: "pending",
    job,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<CronRefDatabase>(db)
        .insertInto("grove_cron_refs")
        .values(refToRow(record)),
    );
  }, options);
  return record;
}

function updateRef(
  ref: PersistedGroveCronRef,
  update: { schedulerJobId?: string; status: PersistedGroveCronRef["status"]; error?: string },
  options: BranchStateDatabaseOptions & { nowMs?: number },
): PersistedGroveCronRef {
  // Omitted fields are cleared in SQLite and must not survive in the returned result.
  const { schedulerJobId: _schedulerJobId, error: _error, ...retained } = ref;
  const updated = {
    ...retained,
    ...update,
    updatedAtMs: options.nowMs ?? Date.now(),
  };
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<CronRefDatabase>(db)
        .updateTable("grove_cron_refs")
        .set({
          scheduler_job_id: updated.schedulerJobId ?? null,
          status: updated.status,
          error: updated.error ?? null,
          updated_at_ms: updated.updatedAtMs,
        })
        .where("agent_id", "=", ref.agentId)
        .where("manifest_id", "=", ref.manifestId),
    );
  }, options);
  return updated;
}

export function groveCronSchedulerJobFromResult(value: unknown): { id: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && record.id) {
    return { id: record.id };
  }
  const job = record.job;
  if (job && typeof job === "object" && typeof (job as Record<string, unknown>).id === "string") {
    return { id: (job as Record<string, unknown>).id as string };
  }
  return undefined;
}

function schedulerJobRecordByDeclarationKey(
  value: unknown,
  declarationKey: string,
): (Record<string, unknown> & { id: string }) | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const jobs = (value as Record<string, unknown>).jobs;
  if (!Array.isArray(jobs)) {
    return undefined;
  }
  const matches = jobs.filter(
    (job): job is Record<string, unknown> & { id: string } =>
      Boolean(job) &&
      typeof job === "object" &&
      (job as Record<string, unknown>).declarationKey === declarationKey &&
      typeof (job as Record<string, unknown>).id === "string",
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function groveCronGatewayInput(agentId: string, ref: PersistedGroveCronRef) {
  const job = ref.job;
  return {
    name: job.name ?? job.id,
    declarationKey: ref.declarationKey,
    ...(job.name ? { displayName: job.name } : {}),
    owner: { agentId },
    enabled: true,
    agentId,
    schedule: {
      kind: "cron",
      expr: job.schedule.cron,
      ...(job.schedule.timezone ? { tz: job.schedule.timezone } : {}),
    },
    sessionTarget: job.session === "main" ? `session:agent:${agentId}:main` : job.session,
    wakeMode: "now",
    payload: { kind: "agentTurn", message: job.message },
    delivery: job.delivery
      ? {
          mode: job.delivery.mode,
          ...(job.delivery.channel ? { channel: job.delivery.channel } : {}),
        }
      : { mode: "none" },
  };
}

export function groveCronGatewayJobMatchesRef(
  agentId: string,
  ref: PersistedGroveCronRef,
  value: unknown,
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const live = cronJobDefinitionFromReadView(value as Partial<CronJob>);
  const expected = normalizeCronJobCreate(groveCronGatewayInput(agentId, ref));
  if (
    !expected ||
    typeof live.id !== "string" ||
    typeof live.createdAtMs !== "number" ||
    typeof live.updatedAtMs !== "number" ||
    !live.state
  ) {
    return false;
  }
  const comparableLive = { ...live, payload: { ...live.payload } } as CronJob;
  applyDefaultCronToolsAllow(expected);
  applyDefaultCronToolsAllow(comparableLive);
  const expectedWithPolicy = {
    ...expected,
    ...(comparableLive.scheduledToolPolicy
      ? { scheduledToolPolicy: createTrustedCronScheduledToolPolicy() }
      : {}),
  };
  try {
    return (
      resolveCronJobConfigRevision({
        ...expectedWithPolicy,
        id: live.id,
        createdAtMs: live.createdAtMs,
        updatedAtMs: live.updatedAtMs,
        state: live.state,
      }) === resolveCronJobConfigRevision(comparableLive)
    );
  } catch {
    return false;
  }
}

export async function installGroveCronJobs(
  plan: GroveAddPlan,
  options: BranchStateDatabaseOptions & {
    gateway?: Pick<GroveCronGateway, "add" | "list" | "waitUntilAgentAvailable">;
    nowMs?: number;
  } = {},
): Promise<PersistedGroveCronRef[]> {
  const actions = plan.actions.filter((action) => action.kind === "cronJob");
  if (actions.length === 0) {
    return [];
  }
  if (!options.gateway) {
    throw new GroveCronInstallError(
      "cron_gateway_required",
      "Grove automations require the gateway-owned cron.add API.",
      [],
    );
  }
  const refs: PersistedGroveCronRef[] = [];
  let agentAvailable = false;
  for (const action of actions) {
    const details = action.details as (GroveCronJob & { agentId?: string }) | undefined;
    if (!details?.id) {
      throw new GroveCronInstallError(
        "cron_plan_invalid",
        `Cron action ${action.id} is invalid.`,
        refs,
      );
    }
    const job: GroveCronJob = {
      id: details.id,
      ...(details.name ? { name: details.name } : {}),
      schedule: details.schedule,
      session: details.session,
      message: details.message,
      ...(details.delivery ? { delivery: details.delivery } : {}),
    };
    const pending = persistPendingRef(plan, job, options);
    refs.push(pending);
    let result: { id: string } | undefined;
    if (pending.status === "complete" && pending.schedulerJobId) {
      if (!options.gateway.list) {
        continue;
      }
      if (!agentAvailable) {
        await options.gateway.waitUntilAgentAvailable?.(plan.agent.finalId);
        agentAvailable = true;
      }
      const listedJob = schedulerJobRecordByDeclarationKey(
        await options.gateway.list(plan.agent.finalId),
        pending.declarationKey,
      );
      if (listedJob) {
        if (!groveCronGatewayJobMatchesRef(plan.agent.finalId, pending, listedJob)) {
          throw new GroveCronInstallError(
            "cron_reconcile_conflict",
            `Cron declaration ${JSON.stringify(pending.manifestId)} changed after installation.`,
            refs,
          );
        }
        result = listedJob;
        if (result.id !== pending.schedulerJobId) {
          refs[refs.length - 1] = updateRef(
            pending,
            { status: "complete", schedulerJobId: result.id },
            options,
          );
        }
        continue;
      }
      throw new GroveCronInstallError(
        "cron_reconcile_conflict",
        `Cron declaration ${JSON.stringify(pending.manifestId)} is missing; remove and add the Grove again to recreate it safely.`,
        refs,
      );
    }
    try {
      if (!agentAvailable) {
        await options.gateway.waitUntilAgentAvailable?.(plan.agent.finalId);
        agentAvailable = true;
      }
      if (options.gateway.list) {
        result = schedulerJobRecordByDeclarationKey(
          await options.gateway.list(plan.agent.finalId),
          pending.declarationKey,
        );
      }
      result ??= groveCronSchedulerJobFromResult(
        await options.gateway.add(groveCronGatewayInput(plan.agent.finalId, pending)),
      );
      if (!result) {
        throw new Error("cron.add returned no scheduler job id");
      }
    } catch (error) {
      const message = coerceErrorMessage(error);
      refs[refs.length - 1] = updateRef(pending, { status: "pending", error: message }, options);
      throw new GroveCronInstallError("cron_install_failed", message, refs);
    }
    try {
      refs[refs.length - 1] = updateRef(
        pending,
        { status: "complete", schedulerJobId: result.id },
        options,
      );
    } catch (error) {
      const message = coerceErrorMessage(error);
      throw new GroveCronInstallError(
        "cron_provenance_failed",
        `cron.add succeeded, but its scheduler id could not be persisted: ${message}`,
        refs,
      );
    }
  }
  return refs;
}

export function readGroveCronRefs(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): PersistedGroveCronRef[] {
  const database = openBranchStateDatabase(options);
  if (
    options.readOnly &&
    !database.db /* sqlite-allow-raw: read-only Grove cron table-existence probe. */
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grove_cron_refs'")
      .get()
  ) {
    return [];
  }
  const query = getNodeSqliteKysely<CronRefDatabase>(database.db)
    .selectFrom("grove_cron_refs")
    .selectAll()
    .where("agent_id", "=", agentId)
    .orderBy("manifest_id")
    .compile();
  const rows =
    database.db /* sqlite-allow-raw: execute compiled Kysely with the existing native read error boundary. */
      .prepare(query.sql)
      // SAFETY: The compiled predicate binds a string; the canonical schema supplies the row shape.
      .all(...(query.parameters as SQLInputValue[])) as CronRefRow[];
  return rows.map(rowToRef);
}

export function deleteGroveCronRef(
  agentId: string,
  manifestId: string,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<CronRefDatabase>(db)
        .deleteFrom("grove_cron_refs")
        .where("agent_id", "=", agentId)
        .where("manifest_id", "=", manifestId),
    );
  }, options);
}

export function markGroveCronRefRemoved(
  agentId: string,
  manifestId: string,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): PersistedGroveCronRef | undefined {
  const ref = readGroveCronRefs(agentId, options).find(
    (candidate) => candidate.manifestId === manifestId,
  );
  return ref ? updateRef(ref, { status: "removed" }, options) : undefined;
}

export function upsertGroveCronRef(
  ref: PersistedGroveCronRef,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<CronRefDatabase>(db)
        .insertInto("grove_cron_refs")
        .values(refToRow(ref))
        .onConflict((conflict) =>
          conflict.columns(["agent_id", "manifest_id"]).doUpdateSet((eb) => ({
            schema_version: eb.ref("excluded.schema_version"),
            declaration_key: eb.ref("excluded.declaration_key"),
            scheduler_job_id: eb.ref("excluded.scheduler_job_id"),
            status: eb.ref("excluded.status"),
            job_json: eb.ref("excluded.job_json"),
            error: eb.ref("excluded.error"),
            updated_at_ms: eb.ref("excluded.updated_at_ms"),
          })),
        ),
    );
  }, options);
}
