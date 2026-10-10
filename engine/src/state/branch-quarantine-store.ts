// Dedicated quarantine decisions stay available when primary databases fail.
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ExpressionBuilder } from "kysely";
import { hasErrnoCode } from "../infra/errno.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { applyPrivateModeSync } from "../infra/private-mode.js";
import {
  parseSqliteFileGeneration,
  readStableSqliteFileGeneration,
  sameSqliteFileGeneration,
  serializeSqliteFileGeneration,
  type SqliteFileGeneration,
} from "../infra/sqlite-file-generation.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { VERSION } from "../version.js";
import { invalidateBranchAgentDatabaseValidation } from "./branch-agent-db-validation-cache.js";
import {
  BranchQuarantineReadCleanupError,
  type BranchDatabaseKind,
  type BranchDatabaseQuarantine,
} from "./branch-quarantine-error.js";
import { BRANCH_DATABASE_SCHEMA_DOCS_URL } from "./branch-state-db-contract.js";
import { resolveQuarantineStorePath } from "./branch-state-db.paths.js";

const BRANCH_QUARANTINE_SCHEMA_VERSION = 2;
const BRANCH_QUARANTINE_BUSY_TIMEOUT_MS = 5_000;
const BRANCH_QUARANTINE_DIR_MODE = 0o700;
const BRANCH_QUARANTINE_FILE_MODE = 0o600;

function resolveAgentIntegrityPath(pathname: string): string {
  try {
    return realpathSync.native(pathname);
  } catch (error) {
    if (!hasErrnoCode(error, "ENOENT")) {
      throw error;
    }
    return path.resolve(pathname);
  }
}

export type BranchAgentIntegrityVerification = {
  path: string;
  dev: string;
  ino: string;
  app_version: string;
  verified_at: number;
  clean_close: number;
};
type IntegrityDatabase = { agent_integrity_verifications: BranchAgentIntegrityVerification };

/** The lease owner consumes this receipt under the shared writer admission. */
export function readBranchAgentIntegrityVerification(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
  consume = false,
): BranchAgentIntegrityVerification | undefined {
  const read = (database: DatabaseSync) => {
    const query = getNodeSqliteKysely<IntegrityDatabase>(database);
    const row = executeSqliteQueryTakeFirstSync(
      database,
      query
        .selectFrom("agent_integrity_verifications")
        .selectAll()
        .where("path", "=", resolveAgentIntegrityPath(pathname)),
    );
    if (consume) {
      const current = statSync(pathname, { bigint: true, throwIfNoEntry: false });
      executeSqliteQuerySync(
        database,
        query
          .updateTable("agent_integrity_verifications")
          .set({ clean_close: 0 })
          .where((eb) =>
            eb.or([
              eb("path", "=", resolveAgentIntegrityPath(pathname)),
              ...(current
                ? [
                    eb.and([
                      eb("dev", "=", String(current.dev)),
                      eb("ino", "=", String(current.ino)),
                    ]),
                  ]
                : []),
            ]),
          ),
      );
    }
    return row;
  };
  if (consume) {
    // Failure cannot admit a writer while leaving an old clean receipt reusable.
    return withQuarantineWriter(env, (database) =>
      runSqliteImmediateTransactionSync(database, () => read(database), {
        databaseLabel: resolveQuarantineStorePath(env),
        operationLabel: "quarantine.integrity.consume",
      }),
    );
  }
  const storePath = resolveQuarantineStorePath(env);
  if (!existsSync(storePath)) {
    return undefined;
  }
  let database: DatabaseSync | undefined;
  try {
    database = openNodeSqliteDatabase(storePath, { readOnly: true });
    return read(database);
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

export function canReuseBranchAgentIntegrityVerification(
  pathname: string,
  record: BranchAgentIntegrityVerification | undefined,
  migrationPending: boolean,
): boolean {
  if (
    migrationPending ||
    !record ||
    record.clean_close !== 1 ||
    record.app_version !== VERSION ||
    record.path !== resolveAgentIntegrityPath(pathname)
  ) {
    return false;
  }
  const current = statSync(pathname, { bigint: true, throwIfNoEntry: false });
  return (
    current !== undefined &&
    record.dev === String(current.dev) &&
    record.ino === String(current.ino)
  );
}

/** Record the lease owner's full check without certifying a clean close. */
export function recordBranchAgentIntegrityVerification(
  pathname: string,
  env: NodeJS.ProcessEnv,
  identity: string,
): void {
  const current = statSync(pathname, { bigint: true, throwIfNoEntry: false });
  if (!current || identity !== `${current.dev}:${current.ino}`) {
    return;
  }
  const dev = String(current.dev);
  const ino = String(current.ino);
  withQuarantineWriter(env, (database) => {
    const query = getNodeSqliteKysely<IntegrityDatabase>(database);
    executeSqliteQuerySync(
      database,
      query
        .insertInto("agent_integrity_verifications")
        .values({
          path: resolveAgentIntegrityPath(pathname),
          dev,
          ino,
          app_version: VERSION,
          verified_at: Date.now(),
          clean_close: 0,
        })
        .onConflict((conflict) =>
          conflict.column("path").doUpdateSet({
            dev,
            ino,
            app_version: VERSION,
            verified_at: Date.now(),
            clean_close: 0,
          }),
        ),
    );
  });
}

/** Unclean disposal removes the proof that any surviving last closer could certify. */
export function clearBranchAgentIntegrityVerification(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
  runtimeProof: "revoke" | "retain" = "revoke",
): void {
  if (runtimeProof === "revoke") {
    invalidateBranchAgentDatabaseValidation(pathname);
  }
  withQuarantineWriter(env, (database) =>
    runSqliteImmediateTransactionSync(
      database,
      () => invalidateAgentIntegrityVerification(database, pathname, runtimeProof),
      {
        databaseLabel: resolveQuarantineStorePath(env),
        operationLabel: "quarantine.integrity.invalidate",
      },
    ),
  );
}

function invalidateAgentIntegrityVerification(
  database: DatabaseSync,
  pathname: string,
  runtimeProof: "revoke" | "retain" = "revoke",
): void {
  const query = getNodeSqliteKysely<IntegrityDatabase>(database);
  const stored = executeSqliteQueryTakeFirstSync(
    database,
    query
      .selectFrom("agent_integrity_verifications")
      .select(["dev", "ino"])
      .where("path", "=", resolveAgentIntegrityPath(pathname)),
  );
  const current = statSync(pathname, { bigint: true, throwIfNoEntry: false });
  if (runtimeProof === "revoke") {
    for (const file of [stored, current]) {
      if (file) {
        invalidateBranchAgentDatabaseValidation(pathname, `${file.dev}:${file.ino}`);
      }
    }
  }
  const matchesFile = (eb: ExpressionBuilder<IntegrityDatabase, "agent_integrity_verifications">) =>
    eb.or([
      eb("path", "=", resolveAgentIntegrityPath(pathname)),
      ...[stored, current].flatMap((file) =>
        file ? [eb.and([eb("dev", "=", String(file.dev)), eb("ino", "=", String(file.ino))])] : [],
      ),
    ]);
  // A blocked checkpoint dirties restart proof, but a later last writer can
  // still certify this verified file after completing its checkpoint and close.
  if (runtimeProof === "retain") {
    executeSqliteQuerySync(
      database,
      query.updateTable("agent_integrity_verifications").set({ clean_close: 0 }).where(matchesFile),
    );
  } else {
    executeSqliteQuerySync(
      database,
      query.deleteFrom("agent_integrity_verifications").where(matchesFile),
    );
  }
}

/** Only the last graceful lease release may publish cleanliness. */
export function markBranchAgentIntegrityClean(
  pathname: string,
  env: NodeJS.ProcessEnv,
  identity: string,
): "written" | "file-changed" | "verification-missing" {
  const current = statSync(pathname, { bigint: true, throwIfNoEntry: false });
  if (!current || identity !== `${current.dev}:${current.ino}`) {
    return "file-changed";
  }
  return withQuarantineWriter(env, (database) => {
    const query = getNodeSqliteKysely<IntegrityDatabase>(database);
    const result = executeSqliteQuerySync(
      database,
      query
        .updateTable("agent_integrity_verifications")
        .set({ clean_close: 1 })
        .where("path", "=", resolveAgentIntegrityPath(pathname))
        .where("dev", "=", String(current.dev))
        .where("ino", "=", String(current.ino))
        .where("app_version", "=", VERSION),
    );
    return result.numAffectedRows === 1n ? "written" : "verification-missing";
  });
}

// Read admission needs this error without importing schema migrations.
function createBranchDatabaseVerificationError(
  kind: "agent" | "state",
  pathname: string,
  storedError: string | null,
): Error {
  // Doctor's clearing hooks run after a full integrity assertion, so a still-
  // corrupt file cannot be cleared directly: the file must be healthy first.
  const error = new Error(
    `Branch Agent ${kind} database ${pathname} is quarantined after integrity verification failed: ${storedError ?? "unknown integrity error"}. Restore the database from a backup or repair it, then run branch doctor --fix to clear the quarantine. See ${BRANCH_DATABASE_SCHEMA_DOCS_URL}.`,
  );
  error.name = "SqliteIntegrityError";
  return error;
}

function ensureQuarantineStoreDirectory(storePath: string): void {
  const dir = path.dirname(storePath);
  mkdirSync(dir, { recursive: true, mode: BRANCH_QUARANTINE_DIR_MODE });
  applyPrivateModeSync(dir, BRANCH_QUARANTINE_DIR_MODE);
}

function configureQuarantineWriter(database: DatabaseSync, storePath: string): void {
  database.exec(`
    PRAGMA busy_timeout = ${BRANCH_QUARANTINE_BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
  `);
  const userVersion = readQuarantineSchemaVersion(database, storePath);
  if (userVersion > BRANCH_QUARANTINE_SCHEMA_VERSION) {
    throw new Error(
      `Branch Agent quarantine store ${storePath} uses newer schema version ${userVersion}.`,
    );
  }
  if (userVersion === BRANCH_QUARANTINE_SCHEMA_VERSION) {
    return;
  }
  if (userVersion === 1) {
    database.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE quarantined_databases ADD COLUMN verified_generation TEXT;
      PRAGMA user_version = ${BRANCH_QUARANTINE_SCHEMA_VERSION};
      COMMIT;
    `);
    return;
  }
  database.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS quarantined_databases (
      path TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      quarantined_at INTEGER NOT NULL,
      writer_app_version TEXT,
      verified_generation TEXT
    ) STRICT;
    PRAGMA user_version = ${BRANCH_QUARANTINE_SCHEMA_VERSION};
    COMMIT;
  `);
}

function readQuarantineSchemaVersion(database: DatabaseSync, storePath: string): number {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version?: unknown }
    | undefined;
  const userVersion = row?.user_version;
  if (typeof userVersion !== "number" || !Number.isInteger(userVersion)) {
    throw new Error(`Branch Agent quarantine store ${storePath} has an invalid schema version.`);
  }
  return userVersion;
}

function withQuarantineWriter<T>(env: NodeJS.ProcessEnv, operation: (db: DatabaseSync) => T): T {
  const storePath = resolveQuarantineStorePath(env);
  const existed = existsSync(storePath);
  ensureQuarantineStoreDirectory(storePath);
  const database = openNodeSqliteDatabase(storePath);
  let completed = false;
  try {
    if (!existed) {
      applyPrivateModeSync(storePath, BRANCH_QUARANTINE_FILE_MODE);
    }
    configureQuarantineWriter(database, storePath);
    database.exec(`CREATE TABLE IF NOT EXISTS agent_integrity_verifications (
      path TEXT NOT NULL PRIMARY KEY, dev TEXT NOT NULL, ino TEXT NOT NULL,
      app_version TEXT NOT NULL, verified_at INTEGER NOT NULL,
      clean_close INTEGER NOT NULL CHECK (clean_close IN (0, 1))
    ) STRICT;`);
    database.exec(`CREATE TABLE IF NOT EXISTS quarantined_session_rows (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, session_key TEXT NOT NULL,
      row_json TEXT NOT NULL, reason TEXT NOT NULL, quarantined_at INTEGER NOT NULL,
      writer_app_version TEXT
    ) STRICT;`);
    const result = operation(database);
    completed = true;
    return result;
  } finally {
    // Failed rollback retires the handle; a second close would mask the write error.
    if (database.isOpen) {
      database.close();
    }
    if (completed || !existed) {
      applyPrivateModeSync(storePath, BRANCH_QUARANTINE_FILE_MODE);
    }
  }
}

/** Read one authoritative quarantine decision without creating the store. */
function readBranchDatabaseQuarantine(
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): BranchDatabaseQuarantine | undefined {
  const storePath = resolveQuarantineStorePath(options.env ?? process.env);
  // Clean installs pay one existence check. No directory or SQLite work.
  if (!existsSync(storePath)) {
    return undefined;
  }
  const database = openNodeSqliteDatabase(storePath);
  let outcome: { value: BranchDatabaseQuarantine | undefined } | { error: unknown };
  try {
    outcome = { value: readQuarantineDecision(database, pathname, storePath) };
  } catch (error) {
    outcome = { error };
  }
  try {
    database.close();
  } catch (closeError) {
    throw new BranchQuarantineReadCleanupError(
      "error" in outcome ? [outcome.error, closeError] : [closeError],
      "value" in outcome ? outcome.value : undefined,
    );
  }
  if ("error" in outcome) {
    throw outcome.error;
  }
  return outcome.value;
}

function readQuarantineDecision(
  database: DatabaseSync,
  pathname: string,
  storePath: string,
): BranchDatabaseQuarantine | undefined {
  database.exec(`PRAGMA busy_timeout = ${BRANCH_QUARANTINE_BUSY_TIMEOUT_MS};`);
  const userVersion = readQuarantineSchemaVersion(database, storePath);
  if (userVersion === 0) {
    return undefined;
  }
  if (userVersion > BRANCH_QUARANTINE_SCHEMA_VERSION) {
    throw new Error(
      `Branch Agent quarantine store ${storePath} uses newer schema version ${userVersion}.`,
    );
  }
  const generationColumn = userVersion >= 2 ? ", verified_generation" : "";
  const row = database
    .prepare(
      `SELECT kind, reason, quarantined_at${generationColumn} FROM quarantined_databases WHERE path = ? LIMIT 1`,
    )
    .get(path.resolve(pathname)) as
    | {
        kind?: unknown;
        quarantined_at?: unknown;
        reason?: unknown;
        verified_generation?: unknown;
      }
    | undefined;
  if (!row) {
    return undefined;
  }
  if (
    (row.kind !== "agent" && row.kind !== "state") ||
    typeof row.reason !== "string" ||
    typeof row.quarantined_at !== "number" ||
    !Number.isInteger(row.quarantined_at) ||
    (row.verified_generation !== undefined &&
      row.verified_generation !== null &&
      typeof row.verified_generation !== "string")
  ) {
    throw new Error(`Branch Agent quarantine store ${storePath} contains an invalid row.`);
  }
  if (typeof row.verified_generation === "string") {
    let verifiedGeneration: SqliteFileGeneration;
    try {
      verifiedGeneration = parseSqliteFileGeneration(row.verified_generation);
    } catch {
      throw new Error(`Branch Agent quarantine store ${storePath} contains an invalid row.`);
    }
    try {
      const currentGeneration = readStableSqliteFileGeneration(path.resolve(pathname));
      if (!sameSqliteFileGeneration(verifiedGeneration, currentGeneration)) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return { kind: row.kind, quarantinedAt: row.quarantined_at, reason: row.reason };
}

/** Runtime opens refuse recorded damage while tolerating a broken quarantine index. */
export function readBranchDatabaseQuarantineFailure(
  kind: BranchDatabaseKind,
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Error | undefined {
  let quarantine: BranchDatabaseQuarantine | undefined;
  let cleanupFailure: BranchQuarantineReadCleanupError | undefined;
  try {
    quarantine = readBranchDatabaseQuarantine(pathname, options);
  } catch (error) {
    // Unreadable metadata stays best effort; unfinished cleanup retains its disposal owner.
    if (!(error instanceof BranchQuarantineReadCleanupError)) {
      return undefined;
    }
    if (!error.quarantine) {
      throw error;
    }
    quarantine = error.quarantine;
    cleanupFailure = error;
  }
  if (!quarantine) {
    return undefined;
  }
  const failure = createBranchDatabaseVerificationError(kind, pathname, quarantine.reason);
  if (cleanupFailure) {
    failure.cause = cleanupFailure;
  }
  return failure;
}

/** Persist one authoritative quarantine decision. */
export function recordBranchDatabaseQuarantine(options: {
  env?: NodeJS.ProcessEnv;
  generation?: SqliteFileGeneration;
  kind: BranchDatabaseKind;
  path: string;
  reason: string;
}): boolean {
  const serializedGeneration = options.generation
    ? serializeSqliteFileGeneration(options.generation)
    : null;
  try {
    return withQuarantineWriter(options.env ?? process.env, (database) =>
      runSqliteImmediateTransactionSync(
        database,
        () => {
          database
            .prepare(
              `
              INSERT INTO quarantined_databases (
                path, kind, reason, quarantined_at, writer_app_version, verified_generation
              ) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(path) DO UPDATE SET
                kind = excluded.kind,
                reason = excluded.reason,
                quarantined_at = excluded.quarantined_at,
                writer_app_version = excluded.writer_app_version,
                verified_generation = excluded.verified_generation
            `,
            )
            .run(
              path.resolve(options.path),
              options.kind,
              options.reason,
              Date.now(),
              VERSION,
              serializedGeneration,
            );
          if (options.kind === "agent") {
            invalidateAgentIntegrityVerification(database, options.path);
          }
          return true;
        },
        {
          databaseLabel: resolveQuarantineStorePath(options.env ?? process.env),
          operationLabel: "quarantine.record",
        },
      ),
    );
  } catch {
    return false;
  }
}

export type BranchSessionRowQuarantine = {
  path: string;
  sessionKey: string;
  /** The stored session_nodes row exactly as it failed validation, before its repair. */
  row: Record<string, unknown>;
  reason: string;
  quarantinedAt: number;
};

/**
 * Keep the exact bytes of one session row that failed validation before startup rewrites it, so
 * Doctor or the owner can restore anything the rewrite could not carry over. Throws on failure:
 * the caller must not rewrite a row whose original was not recorded.
 */
export function recordBranchSessionRowQuarantine(options: {
  env?: NodeJS.ProcessEnv;
  path: string;
  sessionKey: string;
  row: Record<string, unknown>;
  reason: string;
}): void {
  const env = options.env ?? process.env;
  withQuarantineWriter(env, (database) =>
    runSqliteImmediateTransactionSync(
      database,
      () => {
        database
          .prepare(
            `INSERT INTO quarantined_session_rows (
              path, session_key, row_json, reason, quarantined_at, writer_app_version
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            path.resolve(options.path),
            options.sessionKey,
            JSON.stringify(options.row, (_key, value: unknown) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
            options.reason,
            Date.now(),
            VERSION,
          );
      },
      {
        databaseLabel: resolveQuarantineStorePath(env),
        operationLabel: "quarantine.session-row",
      },
    ),
  );
}

/** Session rows set aside for one agent database, oldest first; never creates the store. */
export function listBranchSessionRowQuarantines(
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): BranchSessionRowQuarantine[] {
  const storePath = resolveQuarantineStorePath(options.env ?? process.env);
  if (!existsSync(storePath)) {
    return [];
  }
  const database = openNodeSqliteDatabase(storePath);
  try {
    database.exec(`PRAGMA busy_timeout = ${BRANCH_QUARANTINE_BUSY_TIMEOUT_MS};`);
    const table = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'quarantined_session_rows'")
      .get();
    if (!table) {
      return [];
    }
    const rows = database
      .prepare(
        `SELECT path, session_key, row_json, reason, quarantined_at
         FROM quarantined_session_rows WHERE path = ? ORDER BY id`,
      )
      .all(path.resolve(pathname)) as Array<{
      path: string;
      session_key: string;
      row_json: string;
      reason: string;
      quarantined_at: number;
    }>;
    return rows.map((row) => ({
      path: row.path,
      sessionKey: row.session_key,
      row: JSON.parse(row.row_json) as Record<string, unknown>,
      reason: row.reason,
      quarantinedAt: row.quarantined_at,
    }));
  } finally {
    database.close();
  }
}

/** Clear one authoritative quarantine decision. */
export function clearBranchDatabaseQuarantine(
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): boolean {
  const env = options.env ?? process.env;
  if (!existsSync(resolveQuarantineStorePath(env))) {
    return true;
  }
  try {
    return withQuarantineWriter(env, (database) =>
      runSqliteImmediateTransactionSync(
        database,
        () => {
          database
            .prepare("DELETE FROM quarantined_databases WHERE path = ?")
            .run(path.resolve(pathname));
          invalidateAgentIntegrityVerification(database, pathname);
          return true;
        },
        {
          databaseLabel: resolveQuarantineStorePath(env),
          operationLabel: "quarantine.clear",
        },
      ),
    );
  } catch {
    return false;
  }
}
