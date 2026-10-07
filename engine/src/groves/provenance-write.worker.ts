import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  GROVE_PACKAGE_LIFECYCLE_LEASE_SCOPE,
  clawPackageLifecycleLeaseKey,
} from "../state/grove-package-lifecycle-lease-key.js";
import type { DB } from "../state/branch-state-db.generated.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { assertBranchStateLeaseWorkerOwnedInTransaction } from "../state/branch-state-lease-worker.js";
import type { BranchStateLeaseIdentity } from "../state/branch-state-lease.types.js";
import type { WorkerOperationHandlers } from "../state/worker-operation-registry.js";
import { rowToRef, selectMcpRefs } from "./mcp-records.js";
import type {
  ClawPackageRefStatus,
  PersistedClawPackageRef,
} from "./package-extension-provenance.js";
import { updateClawPackageRefStatusInDatabase } from "./package-status.kernel.js";
import {
  readGroveInstallRecordFromDatabase,
  readGroveOrphanWorkspaceInDatabase,
} from "./provenance-read.kernel.js";

export const groveProvenanceOperations = {
  "groveProvenance.packageStatus": (
    input: {
      ref: PersistedClawPackageRef;
      status: ClawPackageRefStatus;
      nowMs?: number;
      lease: BranchStateLeaseIdentity;
    },
    { open, stateOptions },
  ) =>
    runBranchStateWriteTransaction(
      ({ db }) => {
        const ref = input.ref;
        const artifact =
          ref.kind === "plugin"
            ? { kind: ref.kind, source: ref.source, ref: ref.ref }
            : {
                kind: ref.kind,
                source: ref.source,
                ref: ref.ref,
                workspace:
                  readGroveInstallRecordFromDatabase(db, ref.agentId)?.workspace ??
                  readGroveOrphanWorkspaceInDatabase(db, ref.agentId)?.workspace ??
                  "",
              };
        if (
          (artifact.kind === "skill" && !artifact.workspace) ||
          input.lease.scope !== GROVE_PACKAGE_LIFECYCLE_LEASE_SCOPE ||
          input.lease.key !== clawPackageLifecycleLeaseKey(artifact)
        ) {
          throw new Error("Grove package claim does not match the held artifact lease");
        }
        assertBranchStateLeaseWorkerOwnedInTransaction(db, input.lease);
        const row = executeSqliteQueryTakeFirstSync(
          db,
          getNodeSqliteKysely<DB>(db)
            .selectFrom("grove_package_refs")
            .select(["relationship", "origin", "independent_owner", "package_integrity"])
            .where("agent_id", "=", ref.agentId)
            .where("package_kind", "=", ref.kind)
            .where("package_source", "=", ref.source)
            .where("package_ref", "=", ref.ref)
            .where("package_version", "=", ref.version),
        );
        if (
          !row ||
          row.package_integrity !== ref.integrity ||
          row.relationship !== ref.relationship ||
          row.origin !== ref.origin ||
          Boolean(row.independent_owner) !== ref.independentOwner
        ) {
          throw new Error(
            `Package ${ref.ref}@${ref.version} ownership changed before its status write.`,
          );
        }
        const result = updateClawPackageRefStatusInDatabase(
          db,
          ref,
          input.status,
          input.nowMs ?? Date.now(),
        );
        assertBranchStateLeaseWorkerOwnedInTransaction(db, input.lease, "write", "commit");
        return result;
      },
      { database: open(), ...stateOptions() },
    ),
  "groveProvenance.reconcileMcp": (
    input: { agentId: string; digests: Record<string, string>; nowMs?: number },
    { open, stateOptions },
  ) =>
    runBranchStateWriteTransaction(
      ({ db }) => {
        const refs = executeSqliteQuerySync(
          db,
          selectMcpRefs(db).where("agent_id", "=", input.agentId).orderBy("name"),
        ).rows.map(rowToRef);
        for (const ref of refs) {
          if (ref.status !== "pending" || input.digests[ref.name] !== ref.configDigest) {
            continue;
          }
          const updatedAtMs = input.nowMs ?? Date.now();
          executeSqliteQuerySync(
            db,
            getNodeSqliteKysely<DB>(db)
              .updateTable("grove_mcp_server_refs")
              .set({ status: "complete", error: null, updated_at_ms: updatedAtMs })
              .where("agent_id", "=", ref.agentId)
              .where("name", "=", ref.name),
          );
          ref.status = "complete";
          ref.updatedAtMs = updatedAtMs;
          delete ref.error;
        }
        return refs;
      },
      { database: open(), ...stateOptions() },
    ),
} satisfies WorkerOperationHandlers;
