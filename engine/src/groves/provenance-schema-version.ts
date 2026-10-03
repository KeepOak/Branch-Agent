import type { DatabaseSync } from "node:sqlite";
import { stableStringify } from "@branch/normalization-core";
import { GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION } from "./provenance-agent-origin.js";

const LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION = "branch.groveInstallRecord.v1" as const;
export const GROVE_INSTALL_RECORD_SCHEMA_VERSION = "branch.groveInstallRecord.v2" as const;
type GroveInstallRecordSchemaVersion =
  | typeof LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION
  | typeof GROVE_INSTALL_RECORD_SCHEMA_VERSION
  | typeof GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION;

export function parseGroveInstallRecordSchemaVersion(value: string): GroveInstallRecordSchemaVersion {
  if (
    value === LEGACY_GROVE_INSTALL_RECORD_SCHEMA_VERSION ||
    value === GROVE_INSTALL_RECORD_SCHEMA_VERSION ||
    value === GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION
  ) {
    return value;
  }
  throw new Error(`Unsupported Grove install record schema ${JSON.stringify(value)}.`);
}

export function upgradeGroveInstallSchema<
  TRecord extends {
    schemaVersion: GroveInstallRecordSchemaVersion;
    planIntegrity: string;
    agentConfigDigest: string;
  },
>(
  db: DatabaseSync,
  agentId: string,
  record: TRecord,
  expectedRecord: TRecord | undefined,
  replacement?: Pick<TRecord, "planIntegrity" | "agentConfigDigest">,
): Omit<TRecord, "schemaVersion"> & { schemaVersion: typeof GROVE_INSTALL_RECORD_SCHEMA_VERSION } {
  if (!expectedRecord || stableStringify(record) !== stableStringify(expectedRecord)) {
    throw new Error(
      `Legacy Grove install record for agent ${JSON.stringify(agentId)} is not an exact resumable attempt.`,
    );
  }
  db /* sqlite-allow-raw: exact legacy retry atomically replaces the consent-bound plan identity. */
    .prepare(
      `UPDATE grove_installs
          SET schema_version = ?, plan_integrity = ?, agent_config_digest = ?
        WHERE agent_id = ?`,
    )
    .run(
      GROVE_INSTALL_RECORD_SCHEMA_VERSION,
      replacement?.planIntegrity ?? record.planIntegrity,
      replacement?.agentConfigDigest ?? record.agentConfigDigest,
      agentId,
    );
  return {
    ...record,
    ...replacement,
    schemaVersion: GROVE_INSTALL_RECORD_SCHEMA_VERSION,
  };
}
