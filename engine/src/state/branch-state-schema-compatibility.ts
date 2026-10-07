import {
  getCanonicalSqliteNamedIndexContracts,
  type SqliteSchemaCompatibility,
  type SqliteSchemaIssue,
} from "../infra/sqlite-schema-contract.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import {
  ORDERED_STARTUP_ADDITIVE_STATE_COLUMNS,
  GROVE_FIRST_USE_ADDITIVE_STATE_COLUMN_DEFINITIONS,
  GROVE_LAZY_ADDITIVE_STATE_COLUMN_DEFINITIONS,
  GROVE_STARTUP_ADDITIVE_STATE_COLUMN_DEFINITIONS,
} from "./branch-state-db-additive-columns.js";
import {
  FIRST_USE_STATE_INDEXES,
  DOCTOR_OWNED_STATE_TABLES,
  FIRST_USE_STATE_TABLES,
  LAZY_ADDITIVE_STATE_INDEXES,
  LAZY_ADDITIVE_STATE_TABLES,
} from "./branch-state-db-contract.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

// Same-version databases may lack additive columns that only a writable open
// can ensure, while read-only planning must keep accepting the older shape.
const GROVE_LAZY_ADDITIVE_STATE_COLUMNS = GROVE_LAZY_ADDITIVE_STATE_COLUMN_DEFINITIONS.map(
  ({ columnName, tableName }) => `${tableName}.${columnName}`,
);

const GROVE_FIRST_USE_ADDITIVE_STATE_COLUMNS = GROVE_FIRST_USE_ADDITIVE_STATE_COLUMN_DEFINITIONS.map(
  ({ columnName, tableName }) => `${tableName}.${columnName}`,
);
const GROVE_FIRST_USE_ADDITIVE_STATE_COLUMN_SET = new Set<string>(
  GROVE_FIRST_USE_ADDITIVE_STATE_COLUMNS,
);
const GROVE_STARTUP_ADDITIVE_STATE_COLUMN_SET = new Set<string>([
  ...GROVE_STARTUP_ADDITIVE_STATE_COLUMN_DEFINITIONS.map(
    ({ columnName, tableName }) => `${tableName}.${columnName}`,
  ),
  ...Object.values(ORDERED_STARTUP_ADDITIVE_STATE_COLUMNS)
    .flat()
    .map(([tableName, definition]) => `${tableName}.${definition.split(" ", 1)[0]}`),
]);
const GROVE_STARTUP_ADDITIVE_STATE_TABLES = [
  "worker_session_tool_operations",
  "worker_turn_tool_authorities",
] as const;
const GROVE_STARTUP_ADDITIVE_STATE_TABLE_SET = new Set<string>(GROVE_STARTUP_ADDITIVE_STATE_TABLES);
const GROVE_READONLY_OPTIONAL_STATE_INDEXES = [
  "idx_meeting_transcript_utterances_id",
  "idx_operator_approvals_source_run_resolved",
  "idx_task_runs_requester_session_key",
  "idx_worker_session_placements_environment",
] as const;
let branchStateCanonicalNamedIndexSet: ReadonlySet<string> | undefined;

function getBranchStateCanonicalNamedIndexSet(): ReadonlySet<string> {
  branchStateCanonicalNamedIndexSet ??= new Set(
    getCanonicalSqliteNamedIndexContracts(BRANCH_STATE_SCHEMA_SQL).map((index) => index.name),
  );
  return branchStateCanonicalNamedIndexSet;
}

const runtimeSchemaCache = new Map<string, string>();

/** Project canonical SQL to the tables the shared runtime may create during this open. */
export function getBranchStateRuntimeSchema(options: {
  includeVersionLazyAdditiveTables: boolean;
  includeAgentDeletionJournal?: boolean;
}): string {
  const { includeVersionLazyAdditiveTables, includeAgentDeletionJournal = true } = options;
  const key = `${includeVersionLazyAdditiveTables}:${includeAgentDeletionJournal}`;
  const cached = runtimeSchemaCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  let schema = BRANCH_STATE_SCHEMA_SQL;
  const omittedTables = [
    ...(includeVersionLazyAdditiveTables ? FIRST_USE_STATE_TABLES : LAZY_ADDITIVE_STATE_TABLES),
    ...(includeAgentDeletionJournal ? [] : DOCTOR_OWNED_STATE_TABLES),
  ];
  const omittedIndexes = includeVersionLazyAdditiveTables
    ? FIRST_USE_STATE_INDEXES
    : LAZY_ADDITIVE_STATE_INDEXES;
  for (const tableName of omittedTables) {
    schema = schema.replace(
      extractSqliteTableSchema(schema, tableName, {
        errorMessage: `lazy additive state schema block is missing for ${tableName}`,
      }),
      "",
    );
  }
  for (const indexName of omittedIndexes) {
    const plainStart = schema.indexOf(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    const uniqueStart = schema.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}`);
    const start = plainStart >= 0 ? plainStart : uniqueStart;
    const end = start >= 0 ? schema.indexOf(";", start) : -1;
    if (start < 0 || end < 0) {
      throw new Error(`lazy additive state schema index is missing for ${indexName}`);
    }
    schema = `${schema.slice(0, start)}${schema.slice(end + 1)}`;
  }
  runtimeSchemaCache.set(key, schema);
  return schema;
}

export const STATE_PERSISTENT_SCHEMA_COMPATIBILITY: SqliteSchemaCompatibility = {
  allowCompatibleAdditiveColumns: true,
  allowedMissingTables: DOCTOR_OWNED_STATE_TABLES,
  allowedMissingColumns: GROVE_FIRST_USE_ADDITIVE_STATE_COLUMNS,
  allowedColumnDefinitions: {
    "diagnostic_events.sequence": ["sequence INTEGER NOT NULL DEFAULT 0"],
    "grove_package_refs.package_integrity": [
      "package_integrity TEXT NOT NULL DEFAULT 'sha256:0000000000000000000000000000000000000000000000000000000000000000'",
    ],
    "grove_package_refs.updated_at_ms": ["updated_at_ms INTEGER NOT NULL DEFAULT 0"],
    "cron_jobs.enabled": ["enabled INTEGER NOT NULL DEFAULT 1"],
    "cron_jobs.name": ["name TEXT NOT NULL DEFAULT ''"],
    "cron_jobs.payload_kind": ["payload_kind TEXT NOT NULL DEFAULT 'message'"],
    "current_conversation_bindings.conversation_kind": [
      "conversation_kind TEXT NOT NULL DEFAULT 'channel'",
    ],
    "operator_approvals.resolution_ref": ["resolution_ref TEXT"],
    "worker_environments.desktop_json": ["desktop_json TEXT"],
    "worker_environments.bootstrap_install_kind": ["bootstrap_install_kind TEXT"],
    "worker_environments.shared_host": ["shared_host INTEGER CHECK (shared_host IN (0, 1))"],
    "worker_environments.node_setup_id": ["node_setup_id TEXT"],
    "worker_environments.node_device_id": ["node_device_id TEXT"],
    "worker_session_placements.terminal_reason": ["terminal_reason TEXT"],
    "worker_session_placements.terminal_at_ms": ["terminal_at_ms INTEGER"],
  },
};

export const BRANCH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY: SqliteSchemaCompatibility = {
  ...STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
  allowedMissingTables: [
    ...LAZY_ADDITIVE_STATE_TABLES,
    ...GROVE_STARTUP_ADDITIVE_STATE_TABLES,
    ...DOCTOR_OWNED_STATE_TABLES,
  ],
  allowedMissingIndexes: GROVE_READONLY_OPTIONAL_STATE_INDEXES,
  allowedMissingColumns: GROVE_LAZY_ADDITIVE_STATE_COLUMNS,
};

/** Identify schema differences that the writable shared-state cold open repairs. */
export function isBranchStateStartupRepairableSchemaIssue(issue: SqliteSchemaIssue): boolean {
  if (issue.code === "missing-table") {
    return GROVE_STARTUP_ADDITIVE_STATE_TABLE_SET.has(issue.objectName);
  }
  if (issue.code === "missing-column") {
    return GROVE_STARTUP_ADDITIVE_STATE_COLUMN_SET.has(issue.objectName);
  }
  return (
    issue.code === "missing-or-drifted-index" &&
    getBranchStateCanonicalNamedIndexSet().has(issue.objectName)
  );
}

/** Identify compatible schema differences repaired only by their feature owner. */
export function isBranchStateFirstUseSchemaIssue(issue: SqliteSchemaIssue): boolean {
  return (
    issue.code === "missing-column" &&
    GROVE_FIRST_USE_ADDITIVE_STATE_COLUMN_SET.has(issue.objectName)
  );
}
