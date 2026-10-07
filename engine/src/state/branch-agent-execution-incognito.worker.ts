import { isMainThread } from "node:worker_threads";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import type {
  SqliteWorkerEphemeralTarget,
  SqliteWorkerPreparedBackend,
} from "../infra/sqlite-worker-contract.js";
import {
  requestSqliteWorkerOperationAdmission,
  SqliteWorkerOpenRefusedError,
} from "../infra/sqlite-worker-operation-admission.js";
import {
  closeBranchAgentDatabaseByPath,
  retainAgentDatabase,
} from "./branch-agent-db-lifecycle.js";
import { getBranchAgentDatabaseIfOpen, openBranchAgentDatabase } from "./branch-agent-db.js";
import { isIncognitoBranchAgentSqlitePath } from "./branch-agent-db.paths.js";
import type {
  AgentDatabaseIncognitoOpen,
  AgentDatabaseIncognitoOperations,
} from "./branch-agent-execution-contract.js";

/** The ephemeral arm retains one native owner for every admitted operation. */
export function createIncognitoAgentDatabaseBackend(
  input: AgentDatabaseIncognitoOpen,
  opening: { databasePath: string; target?: SqliteWorkerEphemeralTarget },
): SqliteWorkerPreparedBackend<AgentDatabaseIncognitoOperations> {
  const options = { agentId: input.agentId, path: input.databasePath, env: input.environment };
  if (
    isMainThread ||
    opening.databasePath !== input.databasePath ||
    opening.target?.kind !== "ephemeral" ||
    opening.target.handle !== input.identity.handle ||
    opening.target.incarnation !== input.identity.incarnation ||
    !isIncognitoBranchAgentSqlitePath(input.databasePath, options)
  ) {
    throw new Error("Incognito open differs from its worker-owned target");
  }
  try {
    requestSqliteWorkerOperationAdmission({ stage: "open", facts: input });
  } catch (error) {
    throw new SqliteWorkerOpenRefusedError(error);
  }
  if (getBranchAgentDatabaseIfOpen(options)) {
    throw new Error("Incognito actor cannot adopt another native database");
  }
  const database = openBranchAgentDatabase(options);
  const release = retainAgentDatabase(database.db);
  let closed = false;
  const close = () => {
    // Native cleanup failure keeps this exact actor unavailable and under broker custody.
    closed = true;
    closeBranchAgentDatabaseByPath(database.path, database.agentId);
    release();
  };
  try {
    if (database.db.location()) {
      throw new Error("Incognito actor requires memory-only SQLite storage");
    }
    requestSqliteWorkerOperationAdmission({
      stage: "prepare",
      facts: { identity: input.identity },
    });
  } catch (error) {
    try {
      close();
    } catch (cleanupError) {
      throw createSqliteLifecycleAggregateError(
        [error, cleanupError],
        "Incognito open and cleanup failed",
        error,
      );
    }
    throw error;
  }
  const assertCurrent = () => {
    if (closed || !database.db.isOpen || getBranchAgentDatabaseIfOpen(options) !== database) {
      throw new Error("Incognito actor lost its retained native database");
    }
  };
  let sessions:
    | ReturnType<
        typeof import("../config/sessions/session-incognito.worker.js").createIncognitoSessionWorker
      >
    | undefined;
  return {
    async prepare(command) {
      if (command.type !== "database.incognito.memory" && !sessions) {
        const { createIncognitoSessionWorker } =
          await import("../config/sessions/session-incognito.worker.js");
        sessions = createIncognitoSessionWorker(database, input.identity, input.environment);
      }
      if (command.type !== "database.incognito.memory") {
        await sessions?.prepare(command);
      }
    },
    execute(command) {
      assertCurrent();
      requestSqliteWorkerOperationAdmission({
        stage: "prepare",
        facts: { identity: input.identity },
      });
      if (command.type !== "database.incognito.memory") {
        if (!sessions) {
          throw new Error("Incognito session operation was not prepared");
        }
        return sessions.execute(command);
      }
      // sqlite-allow-raw -- Connection diagnostics have no Kysely table representation.
      const pageCount = database.db.prepare("PRAGMA page_count").get()?.page_count;
      // sqlite-allow-raw -- SQLite supplies the native allocation unit for this gauge.
      const pageSize = database.db.prepare("PRAGMA page_size").get()?.page_size;
      if (typeof pageCount !== "number" || typeof pageSize !== "number") {
        throw new Error("Incognito memory diagnostics are unavailable");
      }
      return { agentId: input.agentId, pageCount, pageSize, databaseBytes: pageCount * pageSize };
    },
    assertSettled() {
      assertCurrent();
      sessions?.assertSettled();
      if (database.db.isTransaction) {
        throw new Error("Incognito command left an unsettled native transaction");
      }
    },
    close() {
      sessions?.close();
      close();
    },
  };
}
