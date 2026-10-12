import type { DatabaseSync } from "node:sqlite";
import { hasErrnoCode } from "../infra/errno.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { readAgentProvenanceInDatabase } from "./agent-provenance.kernel.js";
import { ensureAgentProvenanceSchema } from "./agent-provenance.schema.js";
import type { AgentCreatedVia, AgentProvenance } from "./agent-provenance.types.js";
import { withExistingBranchStateDatabaseCurrentReadOnly } from "./branch-state-db-readonly.js";
import type { DB as BranchStateKyselyDatabase } from "./branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";

export { ensureAgentProvenanceSchema } from "./agent-provenance.schema.js";
export type { AgentCreatedVia, AgentProvenance } from "./agent-provenance.types.js";

type AgentProvenanceDatabase = Pick<BranchStateKyselyDatabase, "agent_provenance">;
type AgentProvenanceOptions = BranchStateDatabaseOptions & { nowMs?: number };

export function recordAgentProvenance(
  agentId: string,
  provenance: { createdVia: AgentCreatedVia; creatorAgentId?: string },
  options: AgentProvenanceOptions = {},
): void {
  ensureAgentProvenanceSchema(options);
  const id = normalizeAgentId(agentId);
  const creatorAgentId = provenance.creatorAgentId
    ? normalizeAgentId(provenance.creatorAgentId)
    : null;
  const createdAtMs = options.nowMs ?? Date.now();
  runBranchStateWriteTransaction(
    ({ db: sqlite }) => {
      const db = getNodeSqliteKysely<AgentProvenanceDatabase>(sqlite);
      executeSqliteQuerySync(
        sqlite,
        db
          .insertInto("agent_provenance")
          .values({
            agent_id: id,
            created_via: provenance.createdVia,
            creator_agent_id: creatorAgentId,
            created_at_ms: createdAtMs,
          })
          .onConflict((conflict) =>
            conflict.column("agent_id").doUpdateSet({
              created_via: provenance.createdVia,
              creator_agent_id: creatorAgentId,
              created_at_ms: createdAtMs,
            }),
          ),
      );
    },
    options,
    { operationLabel: "agent-provenance.record" },
  );
}

export function readAgentProvenance(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): AgentProvenance | undefined {
  return withExistingBranchStateDatabaseCurrentReadOnly(({ db }) => {
    try {
      return readAgentProvenanceInDatabase(db, agentId);
    } catch (error) {
      // Legacy state may omit this lazy additive table; only its writer installs it.
      if (
        error instanceof Error &&
        hasErrnoCode(error, "ERR_SQLITE_ERROR") &&
        error.message === "no such table: agent_provenance"
      ) {
        return undefined;
      }
      throw error;
    }
  }, options);
}

type AgentProvenanceReadOptions = Pick<BranchStateDatabaseOptions, "env" | "path">;
const DISPLAY_PROVENANCE_BATCH_SIZE = 256;

/** Presentation reads may wait; incarnation checks retain the synchronous reader above. */
export async function readAgentProvenanceForDisplay(
  agentIds: readonly string[],
  options: AgentProvenanceReadOptions = {},
): Promise<AgentProvenance[]> {
  if (agentIds.length === 0) {
    return [];
  }
  const context = captureBranchStateWorkerContext(options);
  const requestedIds = agentIds.map(normalizeAgentId);
  const { executeBranchStateWorker } = await import("./branch-state-worker-store.js");
  const records: AgentProvenance[] = [];
  // Canonical IDs are bounded; chunking keeps roster growth below broker input
  // admission limits while preserving caller order and the first read error.
  for (let offset = 0; offset < requestedIds.length; offset += DISPLAY_PROVENANCE_BATCH_SIZE) {
    const batch = await executeBranchStateWorker(context, {
      type: "agentProvenance.readBatch",
      input: { agentIds: requestedIds.slice(offset, offset + DISPLAY_PROVENANCE_BATCH_SIZE) },
    });
    records.push(...batch);
  }
  return records;
}

export async function listAgentProvenance(
  options: AgentProvenanceReadOptions = {},
): Promise<AgentProvenance[]> {
  const context = captureBranchStateWorkerContext(options);
  const { executeBranchStateWorker } = await import("./branch-state-worker-store.js");
  return executeBranchStateWorker(context, {
    type: "agentProvenance.list",
    input: undefined,
  });
}

/** Delete one row inside the caller's authoritative state transaction. */
export function deleteAgentProvenanceForAgent(database: DatabaseSync, agentId: string): void {
  const db = getNodeSqliteKysely<AgentProvenanceDatabase>(database);
  executeSqliteQuerySync(
    database,
    db.deleteFrom("agent_provenance").where("agent_id", "=", normalizeAgentId(agentId)),
  );
}
