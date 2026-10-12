import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Selectable } from "kysely";
import type { BranchConfig } from "../../config/types.branch.js";
import { extractSqliteTableSchema } from "../../infra/sqlite-schema-sql.js";
import type { DB as BranchStateDatabase } from "../../state/branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabase as StateDatabase,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";
import type { BranchStateAsyncLeaseContext } from "../../state/branch-state-lease-context.js";
import { BRANCH_STATE_SCHEMA_SQL } from "../../state/branch-state-schema.js";
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

const SCHEMA_SQL = [
  ...[
    "skill_workshop_proposals",
    "skill_workshop_collection_reviews",
    "skill_workshop_proposal_rollbacks",
    "skill_workshop_proposal_events",
  ].map((table) => extractSqliteTableSchema(BRANCH_STATE_SCHEMA_SQL, table)),
  `CREATE INDEX IF NOT EXISTS idx_skill_workshop_proposal_events_proposal
  ON skill_workshop_proposal_events(proposal_id, sequence);`,
].join("\n");
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
