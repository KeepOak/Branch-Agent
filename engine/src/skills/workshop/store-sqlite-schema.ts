import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Selectable } from "kysely";
import type { BranchConfig } from "../../config/types.branch.js";
import type { DB as BranchStateDatabase } from "../../state/branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabase as StateDatabase,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";
import type { BranchStateAsyncLeaseContext } from "../../state/branch-state-lease-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import { SKILL_LIFECYCLE_PHYSICAL_SCHEMA_SQL } from "./store-sqlite-lifecycle-physical.js";
import { SKILL_LIFECYCLE_SCHEMA_SQL } from "./store-sqlite-lifecycle.js";
import { SKILL_PRACTICE_SCHEMA_SQL } from "./store-sqlite-practice.js";
import { SKILL_UNDO_EXECUTION_SCHEMA_SQL } from "./store-sqlite-undo-execution.js";
import { SKILL_UNDO_RECEIPTS_SCHEMA_SQL } from "./store-sqlite-undo.js";

export type SkillWorkshopDatabase = Pick<
  BranchStateDatabase,
  | "skill_workshop_proposal_events"
  | "skill_workshop_proposal_rollbacks"
  | "skill_workshop_proposals"
  | "skill_workshop_collection_reviews"
>;
export type SkillProposalRow = Selectable<SkillWorkshopDatabase["skill_workshop_proposals"]>;
export type SkillWorkshopStoreOptions = {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  agentId?: string;
  config?: BranchConfig;
  execution?: {
    context: BranchStateWorkerContext;
    leases: readonly BranchStateAsyncLeaseContext[];
  };
};
export type SkillWorkshopDirectoryStoreOptions = SkillWorkshopStoreOptions & {
  config: BranchConfig;
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_workshop_proposals (
  proposal_id TEXT NOT NULL PRIMARY KEY,
  record_json TEXT NOT NULL,
  owner_agent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'update')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'quarantined', 'stale')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  draft_hash TEXT NOT NULL,
  origin_agent_id TEXT,
  origin_session_key TEXT,
  origin_run_id TEXT,
  origin_message_id TEXT,
  applied_at TEXT,
  rejected_at TEXT,
  quarantined_at TEXT,
  stale_at TEXT,
  status_reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS skill_workshop_collection_reviews (
  review_id TEXT NOT NULL PRIMARY KEY,
  owner_agent_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  kept_names_json TEXT NOT NULL,
  written_names_json TEXT NOT NULL,
  dropped_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS skill_workshop_proposal_rollbacks (
  proposal_id TEXT NOT NULL PRIMARY KEY,
  written_at TEXT NOT NULL,
  target_skill_file TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update')),
  previous_content_hash TEXT,
  previous_content TEXT,
  support_files_json TEXT,
  FOREIGN KEY (proposal_id) REFERENCES skill_workshop_proposals(proposal_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS skill_workshop_proposal_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  proposal_id TEXT NOT NULL,
  proposed_version TEXT NOT NULL,
  revision_hash TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created',
    'revised',
    'evaluation_completed',
    'applied',
    'rejected',
    'quarantined',
    'stale'
  )),
  occurred_at TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  correlation_id TEXT,
  payload_json TEXT,
  FOREIGN KEY (proposal_id) REFERENCES skill_workshop_proposals(proposal_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_skill_workshop_proposal_events_proposal
  ON skill_workshop_proposal_events(proposal_id, sequence);
`;
const ensuredDatabases = new WeakSet<DatabaseSync>();

export function databaseOptions(
  options: SkillWorkshopStoreOptions = {},
): BranchStateDatabaseOptions {
  if (options.stateDir) {
    return {
      ...(options.env ? { env: options.env } : {}),
      path: path.join(path.resolve(options.stateDir), "state", "branch.sqlite"),
    };
  }
  return options.env ? { env: options.env } : {};
}

export function ensureSkillWorkshopSchemaInDatabase(
  database: StateDatabase,
  dbOptions: BranchStateDatabaseOptions,
  assertWrite?: (database: DatabaseSync, stage: "transaction" | "commit") => void,
): void {
  if (ensuredDatabases.has(database.db)) {
    return;
  }
  runBranchStateWriteTransaction(
    ({ db }) => {
      assertWrite?.(db, "transaction");
      // sqlite-allow-raw -- Feature-local additive schema DDL; proposal rows use Kysely.
      db.exec(
        SCHEMA_SQL +
          SKILL_UNDO_RECEIPTS_SCHEMA_SQL +
          SKILL_UNDO_EXECUTION_SCHEMA_SQL +
          SKILL_LIFECYCLE_SCHEMA_SQL +
          SKILL_LIFECYCLE_PHYSICAL_SCHEMA_SQL +
          SKILL_PRACTICE_SCHEMA_SQL,
      );
      assertWrite?.(db, "commit");
    },
    dbOptions,
    { operationLabel: "skill-workshop.schema.ensure" },
  );
  ensuredDatabases.add(database.db);
}
