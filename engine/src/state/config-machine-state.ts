// Machine-owned values retired from branch.json live in the shared state database.
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db-contract.js";
import {
  withExistingBranchStateDatabaseArtifactPreservingReadOnly,
  withExistingBranchStateDatabaseReadOnly,
} from "./branch-state-db-readonly.js";
import { tableExists } from "./branch-state-db-schema-helpers.js";
import type { DB as BranchStateKyselyDatabase } from "./branch-state-db.generated.js";

export type ConfigMachineStateDatabase = Pick<BranchStateKyselyDatabase, "config_machine_state">;

export function normalizeConfigMachineStateKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("config machine state key must not be empty");
  }
  return normalized;
}

export function readConfigMachineStateRowInDatabase(database: DatabaseSync, key: string) {
  if (!tableExists(database, "config_machine_state")) {
    return undefined;
  }
  const db = getNodeSqliteKysely<ConfigMachineStateDatabase>(database);
  return executeSqliteQueryTakeFirstSync(
    database,
    db
      .selectFrom("config_machine_state")
      .select(["value_json", "updated_at_ms"])
      .where("state_key", "=", normalizeConfigMachineStateKey(key)),
  );
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers own the JSON shape for open-ended state keys.
export function readConfigMachineStateWithMetadata<T>(
  key: string,
  options: BranchStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): { value: T; updatedAtMs: number } | undefined {
  const read = ({ db: database }: { db: DatabaseSync }) => {
    const row = readConfigMachineStateRowInDatabase(database, key);
    return row
      ? { value: JSON.parse(row.value_json) as T, updatedAtMs: row.updated_at_ms }
      : undefined;
  };
  return behavior.artifactPreservingReadOnly
    ? withExistingBranchStateDatabaseArtifactPreservingReadOnly(read, options)
    : withExistingBranchStateDatabaseReadOnly(read, options);
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers own the JSON shape for open-ended state keys.
export function readConfigMachineState<T>(
  key: string,
  options: BranchStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): T | undefined {
  return readConfigMachineStateWithMetadata<T>(key, options, behavior)?.value;
}
