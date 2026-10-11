// Row-level quarantine for persisted session rows that fail canonical validation.
// The row stays in its agent database for branch doctor --fix; this record lets
// startup continue and gives operators one durable repair item per bad row.
import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { VERSION } from "../version.js";
import { withQuarantineWriter } from "./branch-quarantine-store.js";
import { resolveQuarantineStorePath } from "./branch-state-db.paths.js";

const SESSION_ROW_QUARANTINE_TABLE = `
  CREATE TABLE IF NOT EXISTS quarantined_session_rows (
    database_path TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_key TEXT NOT NULL,
    reason TEXT NOT NULL,
    row_json TEXT NOT NULL,
    quarantined_at INTEGER NOT NULL,
    writer_app_version TEXT NOT NULL,
    PRIMARY KEY (database_path, session_key)
  ) STRICT;
`;

export type BranchSessionRowQuarantineInput = {
  sessionKey: string;
  reason: string;
  /** Exact stored columns that failed validation, kept for later inspection. */
  row: Readonly<Record<string, unknown>>;
};

export type BranchSessionRowQuarantine = {
  databasePath: string;
  agentId: string;
  sessionKey: string;
  reason: string;
  rowJson: string;
  quarantinedAt: number;
  writerAppVersion: string;
};

function ensureSessionRowQuarantineTable(database: DatabaseSync): void {
  database.exec(SESSION_ROW_QUARANTINE_TABLE);
}

/** Persist row quarantines; throws so callers can keep refusing when no record was written. */
export function recordBranchSessionRowQuarantines(options: {
  env?: NodeJS.ProcessEnv;
  databasePath: string;
  agentId: string;
  rows: readonly BranchSessionRowQuarantineInput[];
}): void {
  if (options.rows.length === 0) {
    return;
  }
  const env = options.env ?? process.env;
  const databasePath = path.resolve(options.databasePath);
  withQuarantineWriter(env, (database) =>
    runSqliteImmediateTransactionSync(
      database,
      () => {
        ensureSessionRowQuarantineTable(database);
        const upsert = database.prepare(`
          INSERT INTO quarantined_session_rows (
            database_path, agent_id, session_key, reason, row_json, quarantined_at, writer_app_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(database_path, session_key) DO UPDATE SET
            agent_id = excluded.agent_id,
            reason = excluded.reason,
            row_json = excluded.row_json,
            writer_app_version = excluded.writer_app_version
        `);
        const now = Date.now();
        for (const row of options.rows) {
          upsert.run(
            databasePath,
            options.agentId,
            row.sessionKey,
            row.reason,
            JSON.stringify(row.row),
            now,
            VERSION,
          );
        }
      },
      {
        databaseLabel: resolveQuarantineStorePath(env),
        operationLabel: "quarantine.session-rows.record",
      },
    ),
  );
}

/** Drop records for rows that validate again; never creates the store. */
export function clearBranchSessionRowQuarantines(options: {
  env?: NodeJS.ProcessEnv;
  databasePath: string;
  sessionKeys: readonly string[];
}): number {
  const env = options.env ?? process.env;
  if (options.sessionKeys.length === 0 || !existsSync(resolveQuarantineStorePath(env))) {
    return 0;
  }
  const databasePath = path.resolve(options.databasePath);
  return withQuarantineWriter(env, (database) =>
    runSqliteImmediateTransactionSync(
      database,
      () => {
        ensureSessionRowQuarantineTable(database);
        const remove = database.prepare(
          "DELETE FROM quarantined_session_rows WHERE database_path = ? AND session_key = ?",
        );
        let removed = 0;
        for (const sessionKey of options.sessionKeys) {
          removed += Number(remove.run(databasePath, sessionKey).changes);
        }
        return removed;
      },
      {
        databaseLabel: resolveQuarantineStorePath(env),
        operationLabel: "quarantine.session-rows.clear",
      },
    ),
  );
}

/** Read-only listing for status and repair surfaces; a missing store has no records. */
export function listBranchSessionRowQuarantines(
  env: NodeJS.ProcessEnv = process.env,
): BranchSessionRowQuarantine[] {
  const storePath = resolveQuarantineStorePath(env);
  if (!existsSync(storePath)) {
    return [];
  }
  const database = openNodeSqliteDatabase(storePath, { readOnly: true });
  try {
    const table = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("quarantined_session_rows");
    if (!table) {
      return [];
    }
    const rows = database
      .prepare(
        `SELECT database_path, agent_id, session_key, reason, row_json, quarantined_at, writer_app_version
         FROM quarantined_session_rows ORDER BY quarantined_at, database_path, session_key`,
      )
      .all() as Array<{
      database_path: string;
      agent_id: string;
      session_key: string;
      reason: string;
      row_json: string;
      quarantined_at: number;
      writer_app_version: string;
    }>;
    return rows.map((row) => ({
      databasePath: row.database_path,
      agentId: row.agent_id,
      sessionKey: row.session_key,
      reason: row.reason,
      rowJson: row.row_json,
      quarantinedAt: row.quarantined_at,
      writerAppVersion: row.writer_app_version,
    }));
  } finally {
    database.close();
  }
}
