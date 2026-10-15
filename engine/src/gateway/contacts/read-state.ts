// Read markers live in the shared state database, never in an agent's own database. Marking
// threads read therefore never waits on an agent's startup inspection or preparation.
//
// A marker is a read-through time. A thread counts as read up to the latest of its own
// lastReadAt, its per-thread marker and the all-threads marker. Markers only ever move forward.
// Every session row builder reads entries through `readThroughEntry`, so the conversation list,
// the inbox, the thread lists and the contact roster all agree.
import { createHash } from "node:crypto";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";

/** Scope of a marker that covers every thread, including threads of agents that are still starting. */
export const ALL_THREADS_SCOPE = "*";

/** A client retry of one user action reuses its mutation id within seconds; 7 days is generous. */
export const READ_MUTATION_RETENTION_MS = 7 * 24 * 60 * 60_000;

const READ_STATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS read_markers (
  scope TEXT NOT NULL PRIMARY KEY,
  read_through_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS read_mutations (
  mutation_id TEXT NOT NULL PRIMARY KEY,
  scopes_sha256 TEXT NOT NULL,
  read_through_ms INTEGER NOT NULL,
  applied_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS read_mutations_applied_at ON read_mutations(applied_at_ms);
`;

const ensuredDatabases = new WeakSet<object>();

export type ReadMarkers = {
  readonly allThreadsMs: number;
  readonly byScope: ReadonlyMap<string, number>;
};

export type ReadMutationResult = { applied: boolean; readThroughMs: number };

/** A mutation id answered for different scopes is a client bug, so it is refused rather than ignored. */
export class ReadMutationConflictError extends Error {
  constructor(mutationId: string) {
    super(`mutationId ${mutationId} was already used for different sessions`);
    this.name = "ReadMutationConflictError";
  }
}

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

/** Markers are cached per database file. Every write in this process drops the entry, so reads stay exact. */
const markerCache = new Map<string, ReadMarkers>();

function loadReadMarkers(options: BranchStateDatabaseOptions): ReadMarkers {
  const { db } = ensureReadStateSchema(options);
  const rows = db
    .prepare("SELECT scope, read_through_ms AS readThroughMs FROM read_markers") // sqlite-allow-raw -- Single-table marker lookup.
    .all() as { scope: string; readThroughMs: number }[];
  const byScope = new Map(rows.map((row) => [row.scope, row.readThroughMs]));
  return { allThreadsMs: byScope.get(ALL_THREADS_SCOPE) ?? 0, byScope };
}

/** The current markers. Row builders call this once per row, so a cache hit must cost nothing. */
export function readReadMarkers(options: BranchStateDatabaseOptions = {}): ReadMarkers {
  const path = openBranchStateDatabase(options).path;
  const cached = markerCache.get(path);
  if (cached) {
    return cached;
  }
  const loaded = loadReadMarkers(options);
  markerCache.set(path, loaded);
  return loaded;
}

function digestScopes(scopes: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...scopes].toSorted())).digest("hex");
}

/**
 * Marks threads read through `nowMs`. `scopes` lists session keys, or is [ALL_THREADS_SCOPE].
 * A retry with the same mutation id and the same scopes answers the stored result and writes nothing.
 * The same id with different scopes throws ReadMutationConflictError.
 */
export function applyReadMutation(
  params: { mutationId: string; scopes: readonly string[]; nowMs: number },
  options: BranchStateDatabaseOptions = {},
): ReadMutationResult {
  ensureReadStateSchema(options);
  const scopesDigest = digestScopes(params.scopes);
  const result = runBranchStateWriteTransaction(
    ({ db }) => {
      // Retention runs first, so an id older than the window is treated as a new mutation.
      db.prepare("DELETE FROM read_mutations WHERE applied_at_ms < ?").run( // sqlite-allow-raw -- Retention for retry ids.
        params.nowMs - READ_MUTATION_RETENTION_MS,
      );
      const seen = db
        .prepare("SELECT scopes_sha256 AS scopesSha256, read_through_ms AS readThroughMs FROM read_mutations WHERE mutation_id = ?") // sqlite-allow-raw -- Idempotency lookup.
        .get(params.mutationId) as { scopesSha256: string; readThroughMs: number } | undefined;
      if (seen) {
        if (seen.scopesSha256 !== scopesDigest) {
          throw new ReadMutationConflictError(params.mutationId);
        }
        return { applied: false, readThroughMs: seen.readThroughMs };
      }
      db.prepare(
        "INSERT INTO read_mutations (mutation_id, scopes_sha256, read_through_ms, applied_at_ms) VALUES (?, ?, ?, ?)", // sqlite-allow-raw -- Records the applied mutation.
      ).run(params.mutationId, scopesDigest, params.nowMs, params.nowMs);
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
  markerCache.delete(openBranchStateDatabase(options).path);
  return result;
}

/**
 * The one helper every session view uses: a thread is read through the latest of its own
 * lastReadAt and the markers that cover it. Returns the stored entry when no marker is later.
 */
export function readThroughEntry<E extends SessionEntry>(
  sessionKey: string,
  entry: E | undefined,
  markers: ReadMarkers,
): E | undefined {
  const marked = Math.max(markers.allThreadsMs, markers.byScope.get(sessionKey) ?? 0);
  if (!entry || marked <= (entry.lastReadAt ?? 0)) {
    return entry;
  }
  return { ...entry, lastReadAt: marked };
}
