import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { withSkillFoundationWrite } from "./foundation-write.js";
import {
  planGardenerLifecycleState,
  type GardenerLifecycleState,
} from "./gardener-lifecycle-policy.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

/** These are durable plans; they do not claim loader exclusion or file restoration. */
export type SkillLifecyclePlan = {
  agentId: string;
  skillFile: string;
  revision: number;
  plannedState: GardenerLifecycleState;
  pinned: boolean;
  createdAtMs: number;
  lastActivityAtMs: number | null;
  plannedAtMs: number;
};
export type SkillLifecyclePlanRun = {
  runId: string;
  agentId: string;
  before: SkillLifecyclePlan[];
  after: SkillLifecyclePlan[];
};
export const SKILL_LIFECYCLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_gardener_lifecycle_plans (
  owner_agent_id TEXT NOT NULL, skill_file TEXT NOT NULL, revision INTEGER NOT NULL,
  plan_json TEXT NOT NULL, PRIMARY KEY (owner_agent_id, skill_file)
) STRICT;
CREATE TABLE IF NOT EXISTS skill_gardener_lifecycle_revision_fences (
  owner_agent_id TEXT NOT NULL,skill_file TEXT NOT NULL,revision INTEGER NOT NULL,
  PRIMARY KEY(owner_agent_id,skill_file)
) STRICT;
CREATE TABLE IF NOT EXISTS skill_gardener_lifecycle_plan_runs (
  owner_agent_id TEXT NOT NULL, run_id TEXT NOT NULL, request_sha256 TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL,
  PRIMARY KEY (owner_agent_id, run_id)
) STRICT;
CREATE TABLE IF NOT EXISTS skill_gardener_lifecycle_plan_run_integrity (
  owner_agent_id TEXT NOT NULL,run_id TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,
  PRIMARY KEY(owner_agent_id,run_id),
  FOREIGN KEY(owner_agent_id,run_id) REFERENCES skill_gardener_lifecycle_plan_runs(owner_agent_id,run_id) ON DELETE CASCADE
) STRICT;
`;
function ownedSkills(db: DatabaseSync, agentId: string): Map<string, number | null> {
  // sqlite-allow-raw -- Only applied Workshop proposals attributed to this exact agent qualify.
  const rows = db
    .prepare(`SELECT p.record_json, p.applied_at FROM skill_workshop_proposals p
    WHERE p.owner_agent_id=? AND p.status='applied' AND NOT EXISTS (
      SELECT 1 FROM skill_workshop_undo_executions e WHERE e.proposal_id=p.proposal_id
      AND json_extract(e.execution_json,'$.phase')='restored')`)
    .all(agentId) as Array<{ record_json: string; applied_at: string | null }>;
  const result = new Map<string, number | null>();
  for (const row of rows) {
    const record = JSON.parse(row.record_json) as {
      target?: { source?: string; skillFile?: string };
    };
    const file = record.target?.skillFile;
    if (
      record.target?.source !== "branch-workshop" ||
      typeof file !== "string" ||
      !path.isAbsolute(file)
    )
      continue;
    const time = row.applied_at === null ? NaN : Date.parse(row.applied_at);
    const old = result.get(file);
    result.set(
      file,
      Number.isSafeInteger(time) && time >= 0 ? Math.min(old ?? time, time) : (old ?? null),
    );
  }
  return result;
}
export function readSkillLifecyclePlansInDatabase(
  db: DatabaseSync,
  agentId: string,
): SkillLifecyclePlan[] {
  requireSkillFoundationAgentId(agentId);
  // sqlite-allow-raw -- Owner namespace prevents cross-agent lifecycle inheritance.
  const rows = db
    .prepare(`SELECT skill_file, revision, plan_json FROM skill_gardener_lifecycle_plans
    WHERE owner_agent_id=? ORDER BY skill_file`)
    .all(agentId) as Array<{ skill_file: string; revision: number; plan_json: string }>;
  return rows.map((row) => {
    const plan = JSON.parse(row.plan_json) as SkillLifecyclePlan;
    if (
      plan.agentId !== agentId ||
      plan.skillFile !== row.skill_file ||
      plan.revision !== row.revision ||
      !Number.isSafeInteger(plan.revision) ||
      plan.revision < 1 ||
      !["active", "stale", "archived"].includes(plan.plannedState) ||
      typeof plan.pinned !== "boolean" ||
      !path.isAbsolute(plan.skillFile) ||
      !Number.isSafeInteger(plan.createdAtMs) ||
      plan.createdAtMs < 0 ||
      !Number.isSafeInteger(plan.plannedAtMs) ||
      plan.plannedAtMs < 0 ||
      (plan.lastActivityAtMs !== null &&
        (!Number.isSafeInteger(plan.lastActivityAtMs) || plan.lastActivityAtMs < 0))
    ) {
      throw new Error("Stored skill lifecycle plan identity is invalid.");
    }
    return plan;
  });
}
export function planSkillLifecycleInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    runId: string;
    nowMs: number;
    targets: readonly { skillFile: string; expectedRevision: number }[];
    protectedSkillFiles: readonly string[];
    cronReferencesComplete: boolean;
  },
  assertCurrent: () => void,
): SkillLifecyclePlanRun {
  const request = structuredClone(params);
  requireSkillFoundationAgentId(request.agentId);
  if (
    !request.runId ||
    request.runId !== request.runId.trim() ||
    !Number.isSafeInteger(request.nowMs) ||
    request.nowMs < 0 ||
    !request.cronReferencesComplete
  ) {
    throw new Error(
      "A stable run id, valid clock and complete cron protection snapshot are required.",
    );
  }
  const targets = request.targets.toSorted((a, b) => a.skillFile.localeCompare(b.skillFile));
  if (
    new Set(targets.map((target) => target.skillFile)).size !== targets.length ||
    targets.some(
      (target) => !Number.isSafeInteger(target.expectedRevision) || target.expectedRevision < 0,
    )
  ) {
    throw new Error("Duplicate lifecycle targets or invalid expected revision.");
  }
  const fingerprint = sha256Hex(
    JSON.stringify({
      ...request,
      targets,
      protectedSkillFiles: [...new Set(request.protectedSkillFiles)].toSorted(),
    }),
  );
  return withSkillFoundationWrite(db, assertCurrent, () => {
    // sqlite-allow-raw -- Exact run retry is immutable and never overwrites a prior snapshot.
    const prior = db
      .prepare(`SELECT request_sha256, before_json, after_json
      FROM skill_gardener_lifecycle_plan_runs WHERE owner_agent_id=? AND run_id=?`)
      .get(request.agentId, request.runId) as
      | { request_sha256: string; before_json: string; after_json: string }
      | undefined;
    if (prior) {
      verifyPlanRunIntegrity(db, request.agentId, request.runId, prior);
      if (prior.request_sha256 !== fingerprint)
        throw new Error("Skill lifecycle run identity conflict.");
      return {
        agentId: request.agentId,
        runId: request.runId,
        before: JSON.parse(prior.before_json),
        after: JSON.parse(prior.after_json),
      };
    }
    const owned = ownedSkills(db, request.agentId);
    const before = readSkillLifecyclePlansInDatabase(db, request.agentId);
    const after = new Map(before.map((plan) => [plan.skillFile, plan]));
    for (const target of targets) {
      if (!owned.has(target.skillFile))
        throw new Error("Lifecycle target is not an applied skill owned by this agent.");
      const old = after.get(target.skillFile);
      if (
        readSkillLifecycleRevisionInDatabase(db, {
          agentId: request.agentId,
          skillFile: target.skillFile,
        }) !== target.expectedRevision
      )
        throw new Error("Skill lifecycle revision conflict.");
      // sqlite-allow-raw -- Existing authoritative file-scoped runtime usage; no new telemetry service.
      const usage = db
        .prepare("SELECT last_used_at_ms FROM skill_usage WHERE skill_file=?")
        .get(target.skillFile) as { last_used_at_ms: number } | undefined;
      const createdAtMs = old?.createdAtMs ?? owned.get(target.skillFile) ?? request.nowMs;
      const lastActivityAtMs = usage?.last_used_at_ms ?? old?.lastActivityAtMs ?? null;
      const pinned = old?.pinned ?? false;
      const plannedState = planGardenerLifecycleState({
        state: old?.plannedState ?? "active",
        managed: true,
        builtin: false,
        pinned,
        referencedByCron: request.protectedSkillFiles.includes(target.skillFile),
        createdAtMs,
        lastActivityAtMs,
        nowMs: request.nowMs,
      });
      const plan: SkillLifecyclePlan = {
        agentId: request.agentId,
        skillFile: target.skillFile,
        revision: target.expectedRevision + 1,
        plannedState,
        pinned,
        createdAtMs,
        lastActivityAtMs,
        plannedAtMs: request.nowMs,
      };
      // sqlite-allow-raw -- CAS checked above while holding this synchronous guarded transaction.
      db.prepare(`INSERT INTO skill_gardener_lifecycle_plans VALUES (?,?,?,?)
        ON CONFLICT(owner_agent_id,skill_file) DO UPDATE SET revision=excluded.revision, plan_json=excluded.plan_json`).run(
        request.agentId,
        target.skillFile,
        plan.revision,
        JSON.stringify(plan),
      );
      writeRevisionFence(db, request.agentId, target.skillFile, plan.revision);
      after.set(target.skillFile, plan);
    }
    const result = {
      agentId: request.agentId,
      runId: request.runId,
      before,
      after: [...after.values()].toSorted((a, b) => a.skillFile.localeCompare(b.skillFile)),
    };
    // sqlite-allow-raw -- Snapshot before every planned run in the same atomic commit.
    writePlanRun(db, request.agentId, request.runId, fingerprint, before, result.after);
    return result;
  });
}

export function readSkillLifecycleRevisionInDatabase(
  db: DatabaseSync,
  params: { agentId: string; skillFile: string },
): number {
  requireSkillFoundationAgentId(params.agentId);
  if (!path.isAbsolute(params.skillFile)) throw new Error("Lifecycle target must be absolute.");
  // sqlite-allow-raw -- Durable deletion fences avoid ABA when a run created a new plan.
  const row = db
    .prepare(
      "SELECT revision FROM skill_gardener_lifecycle_revision_fences WHERE owner_agent_id=? AND skill_file=?",
    )
    .get(params.agentId, params.skillFile) as { revision: number } | undefined;
  const plan = readSkillLifecyclePlansInDatabase(db, params.agentId).find(
    (plan) => plan.skillFile === params.skillFile,
  );
  if (row && (!Number.isSafeInteger(row.revision) || row.revision < 1))
    throw new Error("Invalid lifecycle revision fence.");
  const revision = Math.max(row?.revision ?? 0, plan?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new Error("Invalid lifecycle revision fence.");
  return revision;
}
function writeRevisionFence(
  db: DatabaseSync,
  agentId: string,
  skillFile: string,
  revision: number,
) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("Lifecycle revision exhausted or invalid.");
  // sqlite-allow-raw -- Monotonic per-agent revision survives a restored absence.
  db.prepare(`INSERT INTO skill_gardener_lifecycle_revision_fences VALUES (?,?,?)
    ON CONFLICT(owner_agent_id,skill_file) DO UPDATE SET revision=excluded.revision`).run(
    agentId,
    skillFile,
    revision,
  );
}
function readPlanRun(db: DatabaseSync, agentId: string, runId: string) {
  // sqlite-allow-raw -- Agent-scoped existing atomic run snapshot.
  const row = db
    .prepare(
      "SELECT request_sha256,before_json,after_json FROM skill_gardener_lifecycle_plan_runs WHERE owner_agent_id=? AND run_id=?",
    )
    .get(agentId, runId) as
    | { request_sha256: string; before_json: string; after_json: string }
    | undefined;
  if (row) verifyPlanRunIntegrity(db, agentId, runId, row);
  return row;
}
function verifyPlanRunIntegrity(
  db: DatabaseSync,
  agentId: string,
  runId: string,
  row: { request_sha256: string; before_json: string; after_json: string },
) {
  // sqlite-allow-raw -- Legacy snapshots without integrity are not retroactively trusted for Undo.
  const integrity = db
    .prepare(
      "SELECT snapshot_sha256 FROM skill_gardener_lifecycle_plan_run_integrity WHERE owner_agent_id=? AND run_id=?",
    )
    .get(agentId, runId) as { snapshot_sha256: string } | undefined;
  if (!integrity || integrity.snapshot_sha256 !== sha256Hex(JSON.stringify(row)))
    throw new Error("Lifecycle run snapshot integrity is unavailable or corrupt.");
}
function writePlanRun(
  db: DatabaseSync,
  agentId: string,
  runId: string,
  fingerprint: string,
  before: SkillLifecyclePlan[],
  after: SkillLifecyclePlan[],
) {
  // sqlite-allow-raw -- Before and after snapshots participate in the same guarded write.
  db.prepare("INSERT INTO skill_gardener_lifecycle_plan_runs VALUES (?,?,?,?,?)").run(
    agentId,
    runId,
    fingerprint,
    JSON.stringify(before),
    JSON.stringify(after),
  );
  // sqlite-allow-raw -- Content-addressed original and result metadata snapshots.
  db.prepare("INSERT INTO skill_gardener_lifecycle_plan_run_integrity VALUES (?,?,?)").run(
    agentId,
    runId,
    sha256Hex(
      JSON.stringify({
        request_sha256: fingerprint,
        before_json: JSON.stringify(before),
        after_json: JSON.stringify(after),
      }),
    ),
  );
}
export function setSkillLifecyclePinInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    runId: string;
    skillFile: string;
    expectedRevision: number;
    pinned: boolean;
    nowMs: number;
  },
  assertCurrent: () => void,
): SkillLifecyclePlanRun {
  const request = structuredClone(params);
  requireSkillFoundationAgentId(request.agentId);
  if (
    !request.runId ||
    request.runId !== request.runId.trim() ||
    typeof request.pinned !== "boolean" ||
    !Number.isSafeInteger(request.nowMs) ||
    request.nowMs < 0 ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 1
  )
    throw new Error("Invalid lifecycle pin request.");
  const fingerprint = sha256Hex(JSON.stringify({ operation: "pin", ...request }));
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const prior = readPlanRun(db, request.agentId, request.runId);
    if (prior) {
      if (prior.request_sha256 !== fingerprint) throw new Error("Lifecycle pin run conflict.");
      return {
        agentId: request.agentId,
        runId: request.runId,
        before: JSON.parse(prior.before_json),
        after: JSON.parse(prior.after_json),
      };
    }
    if (!ownedSkills(db, request.agentId).has(request.skillFile))
      throw new Error("Lifecycle pin target is not an owned applied Workshop skill.");
    const before = readSkillLifecyclePlansInDatabase(db, request.agentId);
    const old = before.find((plan) => plan.skillFile === request.skillFile);
    if (!old || readSkillLifecycleRevisionInDatabase(db, request) !== request.expectedRevision)
      throw new Error("Lifecycle pin revision conflict.");
    const plan = {
      ...old,
      pinned: request.pinned,
      revision: request.expectedRevision + 1,
      plannedAtMs: request.nowMs,
    };
    // sqlite-allow-raw -- Pin protection only, never silently restore an archived plan.
    db.prepare(
      "UPDATE skill_gardener_lifecycle_plans SET revision=?,plan_json=? WHERE owner_agent_id=? AND skill_file=?",
    ).run(plan.revision, JSON.stringify(plan), request.agentId, request.skillFile);
    writeRevisionFence(db, request.agentId, request.skillFile, plan.revision);
    const after = before.map((item) => (item.skillFile === request.skillFile ? plan : item));
    writePlanRun(db, request.agentId, request.runId, fingerprint, before, after);
    return { agentId: request.agentId, runId: request.runId, before, after };
  });
}
/** Restores metadata only. The filesystem backup/restore executor is a separate contract. */
export function restoreSkillLifecyclePlanRunInDatabase(
  db: DatabaseSync,
  params: { agentId: string; runId: string; restoreRunId: string },
  assertCurrent: () => void,
) {
  const request = structuredClone(params);
  requireSkillFoundationAgentId(request.agentId);
  if (
    !request.runId ||
    !request.restoreRunId ||
    request.restoreRunId === request.runId ||
    request.runId !== request.runId.trim() ||
    request.restoreRunId !== request.restoreRunId.trim()
  )
    throw new Error("Invalid lifecycle restore identity.");
  const fingerprint = sha256Hex(JSON.stringify({ operation: "restore-plan", ...request }));
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const retry = readPlanRun(db, request.agentId, request.restoreRunId);
    if (retry) {
      if (retry.request_sha256 !== fingerprint) throw new Error("Lifecycle restore run conflict.");
      return {
        agentId: request.agentId,
        runId: request.restoreRunId,
        before: JSON.parse(retry.before_json),
        after: JSON.parse(retry.after_json),
      };
    }
    const source = readPlanRun(db, request.agentId, request.runId);
    if (!source) throw new Error("Owned lifecycle run snapshot is unavailable.");
    const before = readSkillLifecyclePlansInDatabase(db, request.agentId);
    if (JSON.stringify(before) !== source.after_json)
      throw new Error("Lifecycle plans changed after the requested run.");
    const originals = JSON.parse(source.before_json) as SkillLifecyclePlan[];
    if (
      originals.some((plan) => plan.agentId !== request.agentId) ||
      new Set(originals.map((plan) => plan.skillFile)).size !== originals.length
    )
      throw new Error("Lifecycle snapshot ownership is invalid.");
    const after: SkillLifecyclePlan[] = [];
    // Retain independent unchanged rows verbatim; bump each changed or removed row's fence.
    const originalMap = new Map(originals.map((plan) => [plan.skillFile, plan]));
    for (const current of before) {
      const original = originalMap.get(current.skillFile);
      if (original && JSON.stringify(original) === JSON.stringify(current)) {
        after.push(current);
        continue;
      }
      const revision =
        readSkillLifecycleRevisionInDatabase(db, {
          agentId: request.agentId,
          skillFile: current.skillFile,
        }) + 1;
      writeRevisionFence(db, request.agentId, current.skillFile, revision);
      if (!original) {
        // sqlite-allow-raw -- Restore original metadata absence while retaining the ABA fence.
        db.prepare(
          "DELETE FROM skill_gardener_lifecycle_plans WHERE owner_agent_id=? AND skill_file=?",
        ).run(request.agentId, current.skillFile);
      } else {
        const plan = { ...original, revision };
        after.push(plan);
        // sqlite-allow-raw -- Exact after-image checked before any snapshot restoration.
        db.prepare(
          "UPDATE skill_gardener_lifecycle_plans SET revision=?,plan_json=? WHERE owner_agent_id=? AND skill_file=?",
        ).run(revision, JSON.stringify(plan), request.agentId, current.skillFile);
      }
    }
    readSkillLifecyclePlansInDatabase(db, request.agentId);
    writePlanRun(db, request.agentId, request.restoreRunId, fingerprint, before, after);
    return { agentId: request.agentId, runId: request.restoreRunId, before, after };
  });
}

export function readOwnedSkillFilesInDatabase(db: DatabaseSync, agentId: string): string[] {
  requireSkillFoundationAgentId(agentId);
  return [...ownedSkills(db, agentId).keys()].toSorted();
}
/** Called only inside the physical restore completion's admitted transaction. */
export function activateRestoredSkillLifecyclePlanInDatabase(
  db: DatabaseSync,
  params: { agentId: string; skillFile: string; expectedRevision: number },
): void {
  const plan = readSkillLifecyclePlansInDatabase(db, params.agentId).find(
    (plan) => plan.skillFile === params.skillFile,
  );
  if (!plan || plan.revision !== params.expectedRevision || plan.plannedState !== "archived")
    throw Error("Restored lifecycle plan revision changed.");
  const revision = plan.revision + 1;
  writeRevisionFence(db, params.agentId, params.skillFile, revision);
  const restored = { ...plan, plannedState: "active" as const, revision };
  // sqlite-allow-raw -- Preserve pin/usage clocks; source restore sets active without inventing telemetry.
  db.prepare(
    "UPDATE skill_gardener_lifecycle_plans SET revision=?,plan_json=? WHERE owner_agent_id=? AND skill_file=?",
  ).run(revision, JSON.stringify(restored), params.agentId, params.skillFile);
}
