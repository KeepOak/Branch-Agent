// Read markers live in the shared state database, never in an agent's own database. Marking
// threads read therefore never waits on an agent's startup inspection or preparation.
//
// A marker is a read-through time. A thread counts as read up to the latest of its own
// lastReadAt, its per-thread marker and the all-threads marker. Markers only ever move forward,
// and a mutation id is applied once, so a retried request can never move a thread back to unread.
import { runBranchStateWriteTransaction, openBranchStateDatabase, type BranchStateDatabaseOptions } from "../../state/branch-state-db.js";
import type { SessionEntrySummary } from "../../config/sessions/session-accessor.js";

/** Scope of a marker that covers every thread, including threads of agents that are still starting. */
export const ALL_THREADS_SCOPE = "*";

const READ_STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS read_markers (
  scope TEXT NOT NULL PRIMARY KEY,
  read_through_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS read_mutations (
  mutation_id TEXT NOT NULL PRIMARY KEY,
  read_through_ms INTEGER NOT NULL,
  applied_at_ms INTEGER NOT NULL
) STRICT;
`;

const ensuredDatabases = new WeakSet<object>();

export type ReadMarkers = {
  readonly allThreadsMs: number;
  readonly byScope: ReadonlyMap<string, number>;
};

export type ReadMutationResult = { applied: boolean; readThroughMs: number };

function ensureReadStateSchema(options: BranchStateDatabaseOptions): ReturnType<typeof openBranchStateDatabase> {
  const database = openBranchStateDatabase(options);
  if (!ensuredDatabases.has(database.db)) {
    runBranchStateWriteTransaction(
      ({ db }) => {
        db.exec(READ_STATE_SCHEMA_SQL); // sqlite-allow-raw -- Feature-local additive DDL for read markers.
      },
      options,
      { operationLabel: "read-state.schema" },
    );
    ensuredDatabases.add(database.db);
  }
  return database;
}

/** Reads every marker in one small query. Used once per request, before any thread is projected. */
export function readReadMarkers(options: BranchStateDatabaseOptions = {}): ReadMarkers {
  const { db } = ensureReadStateSchema(options);
  const rows = db
    .prepare("SELECT scope, read_through_ms AS readThroughMs FROM read_markers") // sqlite-allow-raw -- Single-table marker lookup.
    .all() as { scope: string; readThroughMs: number }[];
  const byScope = new Map(rows.map((row) => [row.scope, row.readThroughMs]));
  return { allThreadsMs: byScope.get(ALL_THREADS_SCOPE) ?? 0, byScope };
}

/**
 * Marks threads read through `nowMs`. `scopes` lists session keys, or is [ALL_THREADS_SCOPE].
 * The same mutation id is applied once and answers with the stored result on every retry.
 */
export function applyReadMutation(
  params: { mutationId: string; scopes: readonly string[]; nowMs: number },
  options: BranchStateDatabaseOptions = {},
): ReadMutationResult {
  ensureReadStateSchema(options);
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const seen = db
        .prepare("SELECT read_through_ms AS readThroughMs FROM read_mutations WHERE mutation_id = ?") // sqlite-allow-raw -- Idempotency lookup.
        .get(params.mutationId) as { readThroughMs: number } | undefined;
      if (seen) {
        return { applied: false, readThroughMs: seen.readThroughMs };
      }
      db.prepare(
        "INSERT INTO read_mutations (mutation_id, read_through_ms, applied_at_ms) VALUES (?, ?, ?)", // sqlite-allow-raw -- Records the applied mutation.
      ).run(params.mutationId, params.nowMs, params.nowMs);
      const upsert = db.prepare(
        `INSERT INTO read_markers (scope, read_through_ms, updated_at_ms) VALUES (?, ?, ?)
         ON CONFLICT(scope) DO UPDATE SET
           read_through_ms = MAX(read_markers.read_through_ms, excluded.read_through_ms),
           updated_at_ms = excluded.updated_at_ms`, // sqlite-allow-raw -- Max-merge keeps markers moving forward only.
      );
      for (const scope of params.scopes) {
        upsert.run(scope, params.nowMs, params.nowMs);
      }
      return { applied: true, readThroughMs: params.nowMs };
    },
    options,
    { operationLabel: "read-state.mark" },
  );
}

/** A thread is read through the latest of its own lastReadAt and the markers that cover it. */
export function withReadMarkers(row: SessionEntrySummary, markers: ReadMarkers): SessionEntrySummary {
  const marked = Math.max(markers.allThreadsMs, markers.byScope.get(row.sessionKey) ?? 0);
  if (marked <= (row.entry.lastReadAt ?? 0)) {
    return row;
  }
  return { ...row, entry: { ...row.entry, lastReadAt: marked } };
}
