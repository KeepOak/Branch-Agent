import type { DatabaseSync } from "node:sqlite";
import { isRecord } from "@branch/normalization-core/record-coerce";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  parseStateLeaseProcessOwner,
  readStateLeaseProcessOwnerStatus,
  type StateLeaseProcessOwner,
} from "../infra/state-lease-process-owner.js";
import type { DB } from "./branch-state-db.generated.js";
import type {
  BranchStateLeaseIdentity,
  BranchStateLeaseAcquisition,
} from "./branch-state-lease.types.js";

type LeaseDatabase = Pick<DB, "state_leases">;

/** The caller owns the write transaction; only absent or expired leases can be acquired. */
export function acquireBranchStateLeaseInTransaction(
  db: DatabaseSync,
  identity: BranchStateLeaseIdentity,
  leaseMs: number,
  payloadJson: string | null = null,
  nowMs?: number,
): BranchStateLeaseAcquisition {
  // Unless the caller owns a captured clock, sample after transaction admission:
  // BEGIN IMMEDIATE may wait long enough to exhaust a lease sampled beforehand.
  const now = nowMs ?? Date.now();
  const kysely = getNodeSqliteKysely<LeaseDatabase>(db);
  executeSqliteQuerySync(
    db,
    kysely
      .deleteFrom("state_leases")
      .where("scope", "=", identity.scope)
      .where("lease_key", "=", identity.key)
      .where("expires_at", "<=", now),
  );
  const expiresAt = now + leaseMs;
  const inserted = executeSqliteQuerySync(
    db,
    kysely
      .insertInto("state_leases")
      .values({
        scope: identity.scope,
        lease_key: identity.key,
        owner: identity.owner,
        expires_at: expiresAt,
        heartbeat_at: now,
        payload_json: payloadJson,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) => conflict.columns(["scope", "lease_key"]).doNothing()),
  );
  if (inserted.numAffectedRows === 1n) {
    return { kind: "acquired", expiresAt };
  }
  const held = readBranchStateLease(db, identity);
  if (!held) {
    throw new Error("Conflicting state lease disappeared inside its acquisition transaction");
  }
  // The owner token and recorded creation time identify this lease's grant, not liveness.
  return {
    kind: "held",
    holder: { owner: held.owner, epoch: held.createdAt, expiresAt: held.expiresAt },
  };
}

export function readBranchStateLease(
  db: DatabaseSync,
  identity: Pick<BranchStateLeaseIdentity, "scope" | "key">,
) {
  return executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<LeaseDatabase>(db)
      .selectFrom("state_leases")
      .select([
        "owner",
        "created_at as createdAt",
        "expires_at as expiresAt",
        "payload_json as payloadJson",
      ])
      .where("scope", "=", identity.scope)
      .where("lease_key", "=", identity.key),
  );
}

/** Reclaim only a same-host owner whose process identity is provably gone. */
export function reclaimDeadBranchStateLeaseInTransaction(
  db: DatabaseSync,
  identity: Pick<BranchStateLeaseIdentity, "scope" | "key">,
) {
  const existing = readBranchStateLease(db, identity);
  if (
    existing &&
    readStateLeaseProcessOwnerStatus(parseStateLeaseProcessOwner(existing.payloadJson)) === "dead"
  ) {
    releaseBranchStateLeaseInTransaction(db, { ...identity, owner: existing.owner });
    return undefined;
  }
  return existing;
}

export function readBranchStateLeaseExpiry(
  db: DatabaseSync,
  identity: BranchStateLeaseIdentity,
  nowMs?: number,
): number | undefined {
  return executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<LeaseDatabase>(db)
      .selectFrom("state_leases")
      .select("expires_at")
      .where("scope", "=", identity.scope)
      .where("lease_key", "=", identity.key)
      .where("owner", "=", identity.owner)
      .where("expires_at", ">", nowMs ?? Date.now())
      .$narrowType<{ expires_at: number }>(),
  )?.expires_at;
}

function repairMissingProcessStartTime(
  db: DatabaseSync,
  identity: BranchStateLeaseIdentity,
  processOwner: StateLeaseProcessOwner | undefined,
): string | undefined {
  if (processOwner?.startedAt == null) {
    return undefined;
  }
  const row = readBranchStateLease(db, identity);
  const recorded = parseStateLeaseProcessOwner(row?.payloadJson ?? null);
  if (
    row?.owner !== identity.owner ||
    recorded?.startedAt !== null ||
    recorded.pid !== processOwner.pid ||
    recorded.host !== processOwner.host ||
    !row.payloadJson
  ) {
    return undefined;
  }
  const payload: unknown = JSON.parse(row.payloadJson);
  if (!isRecord(payload) || !isRecord(payload.owner)) {
    return undefined;
  }
  return JSON.stringify({
    ...payload,
    owner: { ...payload.owner, startedAt: processOwner.startedAt },
  });
}

/** The caller owns the write transaction; expired or replaced owners cannot renew. */
export function renewBranchStateLeaseInTransaction(
  db: DatabaseSync,
  identity: BranchStateLeaseIdentity,
  leaseMs: number,
  processOwner?: StateLeaseProcessOwner,
  nowMs?: number,
): number | undefined {
  const now = nowMs ?? Date.now();
  const expiresAt = now + leaseMs;
  const payloadJson = repairMissingProcessStartTime(db, identity, processOwner);
  const result = executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<LeaseDatabase>(db)
      .updateTable("state_leases")
      .set({
        expires_at: expiresAt,
        heartbeat_at: now,
        updated_at: now,
        ...(payloadJson === undefined ? {} : { payload_json: payloadJson }),
      })
      .where("scope", "=", identity.scope)
      .where("lease_key", "=", identity.key)
      .where("owner", "=", identity.owner)
      .where("expires_at", ">", now),
  );
  return result.numAffectedRows === 1n ? expiresAt : undefined;
}

/** The caller owns the write transaction; a replaced owner cannot release its successor. */
export function releaseBranchStateLeaseInTransaction(
  db: DatabaseSync,
  identity: BranchStateLeaseIdentity,
): void {
  executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<LeaseDatabase>(db)
      .deleteFrom("state_leases")
      .where("scope", "=", identity.scope)
      .where("lease_key", "=", identity.key)
      .where("owner", "=", identity.owner),
  );
}
