import type { DatabaseSync } from "node:sqlite";
import type { Result } from "@branch/normalization-core/result";
import { ensureMessageToolRunOutcomeSchema } from "../state/branch-agent-message-tool-outcome-schema.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "../state/branch-state-db-contract.js";
import {
  encodeBranchStateWorkerError,
  type BranchStateWorkerErrorPayload,
} from "../state/branch-state-worker-error.js";
import {
  recordMessageToolRunOutcomeInDatabase,
  type MessageToolRunOutcomeInsert,
} from "./message-tool-run-outcome-store.kernel.js";
import {
  assertTransactionUsable,
  runSqliteImmediateTransactionSync,
} from "./sqlite-transaction.js";
import type { SqliteWorkerBackend } from "./sqlite-worker-contract.js";

export type MessageToolRunOutcomeWorkerOperations = {
  prepare: { input: undefined; output: Result<void, BranchStateWorkerErrorPayload> };
  record: {
    input: MessageToolRunOutcomeInsert;
    output: Result<void, BranchStateWorkerErrorPayload>;
  };
};

export function bindSqliteWorkerBackend(
  _input: undefined,
  context: {
    databasePath: string;
    database: DatabaseSync;
    admit(stage: "transaction" | "commit"): void;
  },
): SqliteWorkerBackend<MessageToolRunOutcomeWorkerOperations> {
  const db = context.database;
  return {
    execute(command) {
      try {
        if (command.type === "prepare") {
          // First-use schema admission commits before recording, as on the native owner.
          ensureMessageToolRunOutcomeSchema(db, (stage) => context.admit(stage));
          return { ok: true, value: undefined };
        }
        runSqliteImmediateTransactionSync(
          db,
          () => {
            context.admit("transaction");
            recordMessageToolRunOutcomeInDatabase(db, command.input);
          },
          {
            operationLabel: "message-tool.run-outcome.record",
            busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
            databaseLabel: context.databasePath,
            withCommit(commit) {
              context.admit("commit");
              commit();
            },
          },
        );
        return { ok: true, value: undefined };
      } catch (error) {
        // Only a settled rollback is a domain failure; uncertain native work stays with the broker.
        assertTransactionUsable(db);
        if (!db.isOpen || db.isTransaction) {
          throw error;
        }
        const failure = encodeBranchStateWorkerError(error, { includeOrdinary: true });
        if (!failure) {
          throw error;
        }
        return { ok: false, error: failure };
      }
    },
    assertSettled() {
      assertTransactionUsable(db);
      if (db.isTransaction) {
        throw new Error("Message-tool outcome transaction did not settle");
      }
    },
    close() {},
  };
}
