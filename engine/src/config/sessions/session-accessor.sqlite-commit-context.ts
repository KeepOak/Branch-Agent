import { createDeferredCore } from "../../shared/deferred.js";
import { assertAgentDatabaseAdmitted } from "../../state/agent-database-admission.js";
import { isBranchAgentDatabasePathCurrent } from "../../state/branch-agent-db-identity.js";
import {
  agentDatabaseLifecycle,
  retainAgentDatabase,
} from "../../state/branch-agent-db-lifecycle.js";
import { registerBranchAgentDatabaseAsyncResource } from "../../state/branch-agent-db-resources.js";
import type { BranchAgentDatabase } from "../../state/branch-agent-db.js";
import { getBranchDatabaseMaintenanceScope } from "../../state/branch-state-db-async-lifecycle.js";
import {
  captureBranchStateDatabaseReadAdmission,
  registerBranchStateDatabaseAsyncResource,
} from "../../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../../state/branch-state-db.paths.js";
import type { SessionEntryCommitContext } from "./session-accessor.types.js";

/** Native-only scopes retain their original handle, not a pathname reopened after commit. */
export async function withNativeSessionCommitContext<T>(
  database: BranchAgentDatabase,
  env: NodeJS.ProcessEnv,
  commit: (source?: SessionEntryCommitContext) => T,
  afterCommitted?: (context: SessionEntryCommitContext) => Promise<void>,
): Promise<T> {
  if (!afterCommitted) {
    return commit();
  }
  if (database.db.isTransaction) {
    throw new Error("Session commit follow-up requires an outer transaction");
  }
  const capturedEnv = Object.freeze({ ...env });
  const state = captureBranchStateDatabaseReadAdmission(
    resolveBranchStateSqlitePath(capturedEnv),
  );
  const maintenance = getBranchDatabaseMaintenanceScope();
  const completion = createDeferredCore();
  let active = true;
  const revoke = () => {
    active = false;
  };
  const context: SessionEntryCommitContext = {
    env: capturedEnv,
    assertCurrent() {
      if (
        !active ||
        agentDatabaseLifecycle.databases.get(database.path) !== database ||
        !isBranchAgentDatabasePathCurrent(database)
      ) {
        throw new Error("Session commit owner is no longer current");
      }
      if (agentDatabaseLifecycle.failures.has(database.path)) {
        throw agentDatabaseLifecycle.failures.get(database.path);
      }
      state.assertCurrent();
      maintenance?.assertAdmission();
      assertAgentDatabaseAdmitted(database.agentId, { env: capturedEnv });
    },
  };
  context.assertCurrent();
  const release = retainAgentDatabase(database.db);
  let unregisterAgent: (() => void) | undefined;
  let unregisterState: (() => void) | undefined;
  try {
    unregisterAgent = registerBranchAgentDatabaseAsyncResource({
      agentId: database.agentId,
      path: database.path,
      revoke,
      close: () => completion.promise,
    });
    unregisterState = registerBranchStateDatabaseAsyncResource({
      close: async (identity) => {
        if (!identity || identity.key === state.identity.key) {
          revoke();
          await completion.promise;
        }
      },
    });
    const result = commit(context);
    await afterCommitted(context);
    return result;
  } finally {
    revoke();
    release();
    completion.resolve();
    unregisterAgent?.();
    unregisterState?.();
  }
}
