import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { digestGroveValue } from "./digest.js";
import {
  toPackageRefExtensionSqlParams,
  type PersistedClawPackageRef,
} from "./package-extension-provenance.js";

export function digestClawPackageRef(ref: PersistedClawPackageRef): string {
  const persisted = {
    schemaVersion: ref.schemaVersion,
    agentId: ref.agentId,
    groveName: ref.groveName,
    kind: ref.kind,
    source: ref.source,
    ref: ref.ref,
    version: ref.version,
    integrity: ref.integrity,
    status: ref.status,
    relationship: ref.relationship,
    origin: ref.origin,
    independentOwner: ref.independentOwner,
    ...(ref.extension ? { extension: ref.extension } : {}),
    installedAtMs: ref.installedAtMs,
    updatedAtMs: ref.updatedAtMs,
  };
  return digestGroveValue(persisted);
}

export function replaceClawPackageRefExpected(
  expected: PersistedClawPackageRef | undefined,
  replacement: PersistedClawPackageRef | undefined,
  options: BranchStateDatabaseOptions = {},
): void {
  const identity = expected ?? replacement;
  if (!identity) {
    throw new Error("Package reference replacement requires an identity.");
  }
  runBranchStateWriteTransaction(({ db }) => {
    const kysely = getNodeSqliteKysely<Pick<DB, "grove_package_refs">>(db);
    if (expected) {
      const extension = toPackageRefExtensionSqlParams(expected.extension);
      // Nullable extension fields participate in the same full-row compare-and-swap.
      const result = executeSqliteQuerySync(
        db,
        kysely
          .deleteFrom("grove_package_refs")
          .where((eb) =>
            eb.and({
              agent_id: expected.agentId,
              package_kind: expected.kind,
              package_source: expected.source,
              package_ref: expected.ref,
              package_version: expected.version,
              package_integrity: expected.integrity,
              schema_version: expected.schemaVersion,
              grove_name: expected.groveName,
              package_status: expected.status,
              relationship: expected.relationship,
              origin: expected.origin,
              independent_owner: expected.independentOwner ? 1 : 0,
              installed_at_ms: expected.installedAtMs,
              updated_at_ms: expected.updatedAtMs,
            }),
          )
          .where("extension_id", "is", extension.extension_id)
          .where("extension_format", "is", extension.extension_format)
          .where("extension_detected_format", "is", extension.extension_detected_format)
          .where("extension_mapped_json", "is", extension.extension_mapped_json)
          .where("extension_unavailable_json", "is", extension.extension_unavailable_json)
          .where("extension_adapter_identity", "is", extension.extension_adapter_identity),
      );
      if (result.numAffectedRows !== 1n) {
        throw new Error(
          `Package reference ${JSON.stringify(`${expected.kind}:${expected.ref}`)} changed after planning.`,
        );
      }
    } else {
      // Any version occupies this dependency edge; only one row is needed to reject it.
      const occupied = executeSqliteQueryTakeFirstSync(
        db,
        kysely
          .selectFrom("grove_package_refs")
          .select((eb) => eb.val(1).as("occupied"))
          .where("agent_id", "=", identity.agentId)
          .where("package_kind", "=", identity.kind)
          .where("package_source", "=", identity.source)
          .where("package_ref", "=", identity.ref)
          .limit(1),
      );
      if (occupied) {
        throw new Error(
          `Package reference ${JSON.stringify(`${identity.kind}:${identity.ref}`)} appeared after planning.`,
        );
      }
    }
    if (replacement) {
      executeSqliteQuerySync(
        db,
        kysely.insertInto("grove_package_refs").values({
          agent_id: replacement.agentId,
          package_kind: replacement.kind,
          package_source: replacement.source,
          package_ref: replacement.ref,
          package_version: replacement.version,
          package_integrity: replacement.integrity,
          schema_version: replacement.schemaVersion,
          grove_name: replacement.groveName,
          package_status: replacement.status,
          relationship: replacement.relationship,
          origin: replacement.origin,
          independent_owner: replacement.independentOwner ? 1 : 0,
          ...toPackageRefExtensionSqlParams(replacement.extension),
          installed_at_ms: replacement.installedAtMs,
          updated_at_ms: replacement.updatedAtMs,
        }),
      );
    }
  }, options);
}
