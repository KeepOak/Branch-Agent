import type { DatabaseSync } from "node:sqlite";
import { sql } from "kysely";
import {
  createSqliteQueryCache,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  prepareSqliteQuerySync,
  prepareSqliteQueryTakeFirstSync,
  sqliteStringSet,
} from "../../infra/kysely-sync.js";
import { runSqliteDeferredTransactionSync } from "../../infra/sqlite-transaction.js";
import type { DB } from "../../state/branch-agent-db.generated.js";
import {
  canonicalSessionValidationQuery,
  hasCanonicalSessionValidationProjection,
  readCanonicalSessionMainKey,
} from "./session-canonical-key.js";
import {
  InvalidPersistedSessionRowError,
  validateCanonicalSessionRow,
  type CanonicalSessionValidationRow,
} from "./session-canonical-row.js";

type ValidationDatabase = { agentId: string; db: DatabaseSync };
type PendingDatabase = Pick<DB, "session_nodes" | "session_canonical_validation_pending">;

export type CanonicalSessionValidationBatch = {
  mainKey: string;
  rows: readonly CanonicalSessionValidationRow[];
  absentKeys: readonly string[];
  hasMore: boolean;
  oversizedRows: number;
};

/** A row that failed validation under its own canonical key, with the exact bytes that failed. */
export type InvalidCanonicalSessionRow = Readonly<{
  row: Readonly<CanonicalSessionValidationRow>;
  reason: string;
}>;

const validatedBatch = Symbol("validatedCanonicalSessionBatch");
export type ValidatedCanonicalSessionValidationBatch = Readonly<CanonicalSessionValidationBatch> & {
  /** Rows set aside for repair; other validation failures still refuse the whole batch. */
  readonly invalidRows: readonly InvalidCanonicalSessionRow[];
  readonly [validatedBatch]: true;
};

export function hasPendingCanonicalSessionValidation(database: ValidationDatabase): boolean {
  return (
    hasCanonicalSessionValidationProjection(database) &&
    Boolean(
      executeSqliteQueryTakeFirstSync(
        database.db,
        getNodeSqliteKysely<PendingDatabase>(database.db)
          .selectFrom("session_canonical_validation_pending")
          .select("session_key")
          .limit(1),
      ),
    )
  );
}

/** First physical admission must validate all rows, even when an imported projection is clean. */
export function seedCanonicalSessionValidation(database: ValidationDatabase): number {
  if (!database.db.isTransaction) {
    throw new Error("Canonical validation seeding requires write admission");
  }
  if (!hasCanonicalSessionValidationProjection(database)) {
    return 0;
  }
  const db = getNodeSqliteKysely<PendingDatabase>(database.db);
  const result = executeSqliteQuerySync(
    database.db,
    db
      .insertInto("session_canonical_validation_pending")
      .columns(["session_key"])
      // SQLite needs WHERE to disambiguate ON CONFLICT from a SELECT join clause.
      .expression(db.selectFrom("session_nodes").select("session_key").where(sql.lit(true)))
      .onConflict((conflict) => conflict.column("session_key").doNothing()),
  );
  return Number(result.numAffectedRows ?? 0n);
}

/** Capture bounded source bytes and policy in one committed snapshot before write admission. */
export function readPendingCanonicalSessionValidationBatch(
  database: ValidationDatabase,
  options: { maxRows: number; maxBytes: number },
): CanonicalSessionValidationBatch {
  if (
    !Number.isSafeInteger(options.maxRows) ||
    options.maxRows < 1 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1
  ) {
    throw new Error("Canonical validation batch limits must be positive safe integers");
  }
  return runSqliteDeferredTransactionSync(database.db, () => {
    if (!hasCanonicalSessionValidationProjection(database)) {
      return { mainKey: "main", rows: [], absentKeys: [], hasMore: false, oversizedRows: 0 };
    }
    const mainKey = readCanonicalSessionMainKey(database);
    const db = getNodeSqliteKysely<PendingDatabase>(database.db);
    const candidates = executeSqliteQuerySync(
      database.db,
      db
        .selectFrom("session_canonical_validation_pending as pending")
        .leftJoin("session_nodes as node", "node.session_key", "pending.session_key")
        .select("pending.session_key")
        .select(
          // kysely-allow-raw: bound native TEXT bytes before materializing saved prompt payloads.
          sql<number>`length(CAST(pending.session_key AS BLOB)) + coalesce(length(CAST(node.entry_json AS BLOB)), 0) + coalesce(length(CAST(node.current_session_id AS BLOB)), 0) * 2 + coalesce(length(CAST(node.parent_session_key AS BLOB)), 0) + coalesce(length(CAST(node.spawned_by AS BLOB)), 0) + coalesce(length(CAST(node.fork_source_session_key AS BLOB)), 0)`.as(
            "bytes",
          ),
        )
        .orderBy("pending.session_key")
        .limit(options.maxRows + 1),
    ).rows;
    const keys: string[] = [];
    let bytes = 0;
    let oversizedRows = 0;
    for (const candidate of candidates) {
      if (
        keys.length >= options.maxRows ||
        (keys.length > 0 && bytes + candidate.bytes > options.maxBytes)
      ) {
        break;
      }
      keys.push(candidate.session_key);
      bytes += candidate.bytes;
      if (candidate.bytes > options.maxBytes) {
        oversizedRows += 1;
      }
    }
    const rows = keys.length
      ? executeSqliteQuerySync(
          database.db,
          canonicalSessionValidationQuery(database).where(
            "session_nodes.session_key",
            "in",
            sqliteStringSet(keys),
          ),
        ).rows
      : [];
    const found = new Set(rows.map((row) => row.session_key));
    return {
      mainKey,
      rows,
      absentKeys: keys.filter((key) => !found.has(key)),
      hasMore: keys.length < candidates.length,
      oversizedRows,
    };
  });
}

/** Keep the exact validated flat fields private and immutable across awaited write admission. */
export function validateCanonicalSessionValidationBatch(
  batch: CanonicalSessionValidationBatch,
): ValidatedCanonicalSessionValidationBatch {
  const rows: CanonicalSessionValidationRow[] = [];
  const invalidRows: InvalidCanonicalSessionRow[] = [];
  for (const row of batch.rows) {
    const snapshot = Object.freeze({ ...row });
    try {
      validateCanonicalSessionRow(snapshot);
      rows.push(snapshot);
    } catch (error) {
      // One bad row must not keep the whole agent from starting (#360). A non-canonical key
      // still needs Doctor's cross-row merge, so only same-key row failures are set aside.
      if (!(error instanceof InvalidPersistedSessionRowError)) {
        throw error;
      }
      invalidRows.push(Object.freeze({ row: snapshot, reason: error.message }));
    }
  }
  const validated: ValidatedCanonicalSessionValidationBatch = {
    ...batch,
    rows: Object.freeze(rows),
    invalidRows: Object.freeze(invalidRows),
    absentKeys: Object.freeze([...batch.absentKeys]),
    [validatedBatch]: true,
  };
  return Object.freeze(validated);
}

function sameCanonicalRow(
  left: CanonicalSessionValidationRow,
  right: CanonicalSessionValidationRow,
): boolean {
  return (
    left.session_key === right.session_key &&
    left.current_session_id === right.current_session_id &&
    left.entry_valid === right.entry_valid &&
    left.entry_json === right.entry_json &&
    left.parent_session_key === right.parent_session_key &&
    left.spawned_by === right.spawned_by &&
    left.fork_source_session_key === right.fork_source_session_key &&
    left.retained_window_id === right.retained_window_id
  );
}

/**
 * Settle only exact validated inputs; changed rows stay pending for the next owner admission.
 * An unchanged invalid row is handed to `repairInvalidRow`, which must rewrite and certify it in
 * this transaction; without one, the batch refuses as before.
 */
export function compareAndCertifyCanonicalSessionValidationBatch(
  database: ValidationDatabase,
  batch: ValidatedCanonicalSessionValidationBatch,
  repairInvalidRow?: (invalid: InvalidCanonicalSessionRow) => void,
): number {
  if (!database.db.isTransaction) {
    throw new Error("Canonical validation certification requires write admission");
  }
  if (
    !hasCanonicalSessionValidationProjection(database) ||
    readCanonicalSessionMainKey(database) !== batch.mainKey
  ) {
    return 0;
  }
  const keys = [
    ...batch.rows.map((row) => row.session_key),
    ...batch.invalidRows.map(({ row }) => row.session_key),
    ...batch.absentKeys,
  ];
  if (keys.length === 0) {
    return 0;
  }
  const current = new Map(
    executeSqliteQuerySync(
      database.db,
      canonicalSessionValidationQuery(database).where(
        "session_nodes.session_key",
        "in",
        sqliteStringSet(keys),
      ),
    ).rows.map((row) => [row.session_key, row]),
  );
  const certifiedKeys = batch.rows.flatMap((row) => {
    const candidate = current.get(row.session_key);
    return candidate && sameCanonicalRow(row, candidate) ? [row.session_key] : [];
  });
  certifiedKeys.push(...batch.absentKeys.filter((key) => !current.has(key)));
  let repairedRows = 0;
  for (const invalid of batch.invalidRows) {
    const candidate = current.get(invalid.row.session_key);
    if (!candidate || !sameCanonicalRow(invalid.row, candidate)) {
      // A changed row is validated again by the next batch; a removed one leaves nothing to fix.
      if (!candidate) {
        certifiedKeys.push(invalid.row.session_key);
      }
      continue;
    }
    if (!repairInvalidRow) {
      validateCanonicalSessionRow(candidate);
    }
    repairInvalidRow?.(invalid);
    repairedRows += 1;
  }
  if (certifiedKeys.length === 0) {
    return repairedRows;
  }
  const result = executeSqliteQuerySync(
    database.db,
    getNodeSqliteKysely<PendingDatabase>(database.db)
      .deleteFrom("session_canonical_validation_pending")
      .where("session_key", "in", sqliteStringSet(certifiedKeys)),
  );
  return Number(result.numAffectedRows ?? 0n) + repairedRows;
}

function prepareCanonicalWriterQueries(database: Pick<ValidationDatabase, "db">) {
  const db = getNodeSqliteKysely<PendingDatabase>(database.db);
  return {
    pending: prepareSqliteQueryTakeFirstSync<string, { session_key: string }>(
      database.db,
      (parameter) =>
        db
          .selectFrom("session_canonical_validation_pending")
          .select("session_key")
          .where(
            "session_key",
            "=",
            parameter((key) => key),
          ),
    ),
    row: prepareSqliteQueryTakeFirstSync<string, CanonicalSessionValidationRow>(
      database.db,
      (parameter) =>
        canonicalSessionValidationQuery(database).where(
          "session_nodes.session_key",
          "=",
          parameter((key) => key),
        ),
    ),
    certify: prepareSqliteQuerySync<string>(database.db, (parameter) =>
      db.deleteFrom("session_canonical_validation_pending").where(
        "session_key",
        "=",
        parameter((key) => key),
      ),
    ),
  };
}

// Retain compiled shapes only; fresh bindings and native statement lifecycle stay with the executor.
const canonicalWriterQueries = createSqliteQueryCache((db) =>
  prepareCanonicalWriterQueries({ db }),
);

/** Canonical writers certify their final row within their existing transaction. */
export function certifyCanonicalSessionValidationRow(
  database: ValidationDatabase,
  sessionKey: string,
): void {
  // Low-level autocommit callers leave invalidation work for the readiness owner.
  if (!database.db.isTransaction || !hasCanonicalSessionValidationProjection(database)) {
    return;
  }
  const queries = canonicalWriterQueries(database.db);
  const pending = queries.pending(sessionKey);
  if (!pending) {
    return;
  }
  // Validate stored metadata after native TEXT binding; saved prompts are not canonical inputs.
  const row = queries.row(pending.session_key);
  if (row) {
    validateCanonicalSessionRow(row);
  }
  // The row was just reread and validated without yielding under the same reservation.
  queries.certify(pending.session_key);
}
