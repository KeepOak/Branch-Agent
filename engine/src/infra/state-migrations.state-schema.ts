import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import {
  prepareBranchStateDatabaseSchema,
  type BranchStateDatabaseSchemaMigration,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import type {
  LegacyStateMigrationEndpoint,
  LegacyStateMigrationMode,
  LegacyStateMigrationStep,
} from "./state-migrations.types.js";

const STATE_SCHEMA_MIGRATION_DESCRIPTIONS: Record<
  BranchStateDatabaseSchemaMigration["kind"],
  string
> = {
  "agent-databases-composite-primary-key": "agent database registry primary key → agent_id,path",
  "audit-events-v2": "audit event ledger → versioned message lifecycle schema",
  "commitments-retirement-v7": "retired commitments storage → discarded rows, table, and indexes",
  "worker-placement-execution-mode-v8": "cloud worker placements → execution-mode claims",
  "agent-databases-relative-paths-v9": "agent database registry paths → state-relative storage",
  "state-table-retirement-v10": "retired shared-state tables → removed tables and indexes",
  "state-table-retirement-v11": "retired skill gardener tables → removed tables and indexes",
  "singleton-state-foldin-v12": "singleton state tables → shared configuration state",
  "state-consolidation-v13": "cron jobs and subagent runs → canonical JSON storage",
  "creator-namespace-v14": "historical cron creators → unknown source attribution",
  "conversation-binding-targets-v15":
    "conversation bindings → exact target keys without agent/session projections",
  "skill-workshop-directory-ownership-v16":
    "Skill Workshop ownership → per-agent directory containment",
  "prepared-worker-ownership-v17":
    "prepared workers → one-use capacity and fixed workspace ownership",
  "github-publication-requester-authority-v18":
    "GitHub publication receipts → original requesting authority",
  "operator-approvals-system-agent": "operator approvals → Branch Agent system changes",
  "session-watch-cursor-provenance-v4": "session watch cursors → provenance column",
  "strict-tables-v3": "tables → SQLite STRICT typing",
};

export function describeStateSchemaMigration(
  migration: BranchStateDatabaseSchemaMigration,
): string {
  return STATE_SCHEMA_MIGRATION_DESCRIPTIONS[migration.kind];
}

export function createStateSchemaMigrationStep(params: {
  stateDir: string;
  env: NodeJS.ProcessEnv;
  mode: LegacyStateMigrationMode | "doctor-preparation";
  requiredness: LegacyStateMigrationStep["requiredness"];
}): LegacyStateMigrationStep {
  const stateEnv = { ...params.env, BRANCH_STATE_DIR: params.stateDir };
  const database: LegacyStateMigrationEndpoint = {
    kind: "sqlite",
    path: resolveBranchStateSqlitePath(stateEnv),
  };
  return {
    id: "state-schema",
    phase: "shared",
    source: [database],
    target: [database],
    requiredness: params.requiredness,
    reversibility: "checkpoint-required",
    run: async () => {
      const result = await prepareBranchStateDatabaseSchema({ env: stateEnv }, params.mode);
      if (result.changes.length > 0) {
        // Schema repair can expose install records hidden from pre-upgrade discovery.
        clearPluginMetadataLifecycleCaches();
      }
      return result;
    },
  };
}
