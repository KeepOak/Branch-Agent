import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import { normalizeAgentId } from "@branch/normalization-core/agent-id";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import {
  registerSqliteCacheExitClose,
  runInSqliteMaintenanceContext,
} from "../infra/sqlite-wal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { BranchAgentDatabaseOptions } from "./branch-agent-db-contract.js";
import {
  createBranchAgentDatabaseClaim,
  isBranchAgentDatabasePathCurrent,
  findBranchAgentDatabaseIdentity,
} from "./branch-agent-db-identity.js";
import {
  hasBranchAgentReadOnlySchema,
  openBranchAgentDatabaseReadOnly,
  readBranchAgentDatabase,
  withFreshBranchAgentDatabaseReadOnly,
  type BranchAgentDatabaseReadOnlyResult,
  type BranchAgentReadOnlyDatabase,
  type BranchAgentReadOnlyDatabaseHandle,
} from "./branch-agent-db-readonly-open.js";
import { registerBranchAgentDatabaseSyncResource } from "./branch-agent-db-resources.js";
import { observeBranchDatabaseMaintenanceResource } from "./branch-state-db-async-lifecycle.js";

export type BranchAgentDatabaseReadOnlyBehavior = {
  allowExtension?: boolean;
};

type ReadTarget = BranchAgentDatabaseOptions & { agentId: string; path: string };
const readOnlyScope = new AsyncLocalStorage<BranchAgentDatabaseReadOnlyScope>();
const log = createSubsystemLogger("state/agent-db");
type ReadOnlyScopes = {
  paths: Map<string, BranchAgentDatabaseReadOnlyScope>;
  active: Set<BranchAgentDatabaseReadOnlyScope>;
  unregisterExit?: () => void;
};
const retainedScopes = resolveGlobalSingleton<ReadOnlyScopes>(
  Symbol.for("branch.agentDatabaseReadOnlyScopes"),
  () => ({ paths: new Map(), active: new Set() }),
);

/** One retained connection, revoked by its caller, database lifecycle, or idle expiry. */
export class BranchAgentDatabaseReadOnlyScope {
  private database?: BranchAgentReadOnlyDatabaseHandle;
  private target?: { agentId: string; path: string };
  private idleTimer?: ReturnType<typeof setTimeout>;
  private unregisterResource?: () => void;
  private borrowers = 0;
  private closing = false;

  constructor(private readonly cached = false) {}

  get hasRetainedConnection(): boolean {
    return this.database !== undefined;
  }

  invalidateProjection(
    databaseIdentity: string,
    invalidate: (database: DatabaseSync) => void,
  ): void {
    if (
      this.database &&
      findBranchAgentDatabaseIdentity(this.database)?.identity === databaseIdentity
    ) {
      invalidate(this.database.db);
    }
  }

  closeIfIdle(): void {
    if (this.borrowers === 0 && (!this.database?.db.isOpen || !this.database.db.isTransaction)) {
      this.discardConnection();
    }
  }

  close(): void {
    this.closing = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    // Failed native cleanup retains custody and blocks reuse until the owner retries.
    this.database?.close();
    this.database = undefined;
    this.borrowers = 0;
    if (this.target && retainedScopes.paths.get(this.target.path) === this) {
      retainedScopes.paths.delete(this.target.path);
    }
    // Descendant async contexts retain this object after run returns. Revoke reuse first.
    this.target = undefined;
    this.unregisterResource?.();
    this.unregisterResource = undefined;
    retainedScopes.active.delete(this);
    if (retainedScopes.active.size === 0) {
      retainedScopes.unregisterExit?.();
      retainedScopes.unregisterExit = undefined;
    }
    this.closing = false;
  }

  private discardConnection(): void {
    const target = this.target;
    this.close();
    // Replacing a connection does not end the caller's still-active read scope.
    if (!this.cached) {
      this.target = target;
    }
  }

  private touch(): void {
    if (!this.database) {
      return;
    }
    if (this.idleTimer) {
      this.idleTimer.refresh();
      return;
    }
    this.idleTimer = runInSqliteMaintenanceContext(() =>
      setTimeout(() => {
        this.idleTimer = undefined;
        try {
          this.closeIfIdle();
        } catch (error) {
          log.warn("Idle agent read-only database cleanup failed", {
            path: this.database?.path,
            error,
          });
        } finally {
          this.touch();
        }
      }, SQLITE_IDLE_HANDLE_TTL_MS),
    );
    this.idleTimer.unref();
  }

  run<T>(target: { agentId: string; path: string }, operation: () => T): T {
    if (this.target?.agentId !== target.agentId || this.target.path !== target.path) {
      this.close();
    }
    this.target = target;
    return readOnlyScope.run(this, operation);
  }

  matches(agentId: string, pathname: string): boolean {
    return this.target?.agentId === agentId && this.target.path === pathname;
  }

  private acquire(options: BranchAgentDatabaseOptions) {
    if (this.database && !isBranchAgentDatabasePathCurrent(this.database)) {
      this.discardConnection();
    }
    if (!this.database) {
      let opened: ReturnType<typeof openBranchAgentDatabaseReadOnly>;
      try {
        opened = openBranchAgentDatabaseReadOnly(options);
      } catch (error) {
        this.discardConnection();
        throw error;
      }
      if (!opened.found) {
        this.discardConnection();
        return opened;
      }
      this.database = opened.database;
      this.target = { agentId: this.database.agentId, path: this.database.path };
      try {
        this.unregisterResource = registerBranchAgentDatabaseSyncResource({
          ...this.target,
          revoke: () => this.close(),
          close: () => this.close(),
        });
        retainedScopes.active.add(this);
        if (this.cached) {
          retainedScopes.paths.set(this.database.path, this);
        }
        retainedScopes.unregisterExit ??= registerSqliteCacheExitClose(() => {
          for (const scope of retainedScopes.active) {
            scope.close();
          }
        });
      } catch (error) {
        this.discardConnection();
        throw error;
      }
    } else if (!hasBranchAgentReadOnlySchema(this.database)) {
      this.discardConnection();
      return { found: false, reason: "schema-missing" } as const;
    }
    const requestedAgentId = normalizeAgentId(options.agentId);
    if (this.database.agentId !== requestedAgentId) {
      throw new Error(
        `Branch Agent agent database ${this.database.path} belongs to agent ${this.database.agentId}; requested agent ${requestedAgentId}.`,
      );
    }
    observeBranchDatabaseMaintenanceResource(this.unregisterResource);
    this.touch();
    return { found: true, database: this.database } as const;
  }

  private releaseBorrow(database: BranchAgentReadOnlyDatabaseHandle): void {
    if (this.database !== database) {
      return;
    }
    this.borrowers--;
    if (
      this.cached &&
      this.borrowers === 0 &&
      this.database &&
      (!this.database.db.isOpen || this.database.db.isTransaction)
    ) {
      this.discardConnection();
    } else {
      this.touch();
    }
  }

  private assertUsable(): void {
    if (this.closing) {
      throw new Error("Agent read-only database native cleanup is pending");
    }
  }

  retain(options: BranchAgentDatabaseOptions) {
    this.assertUsable();
    const opened =
      this.database?.db.isOpen && this.database.db.isTransaction
        ? openBranchAgentDatabaseReadOnly(options)
        : this.acquire(options);
    if (!opened.found) {
      return opened;
    }
    const { database } = opened;
    const shared = database === this.database;
    if (shared) {
      this.borrowers++;
    }
    return {
      found: true,
      database,
      claim: createBranchAgentDatabaseClaim(database, () => {
        if (shared) {
          this.releaseBorrow(database);
        } else {
          database.close();
        }
      }),
    } as const;
  }

  read<T>(
    operation: (database: BranchAgentReadOnlyDatabase) => T,
    options: BranchAgentDatabaseOptions,
  ): BranchAgentDatabaseReadOnlyResult<T> {
    this.assertUsable();
    if (this.database?.db.isOpen && this.database.db.isTransaction) {
      return withFreshBranchAgentDatabaseReadOnly(operation, options);
    }
    const opened = this.acquire(options);
    if (!opened.found) {
      return opened;
    }
    this.borrowers++;
    try {
      return readBranchAgentDatabase(opened.database, operation);
    } catch (error) {
      if (this.cached && this.borrowers === 1) {
        this.discardConnection();
      }
      throw error;
    } finally {
      this.releaseBorrow(opened.database);
    }
  }
}

function cachedScope(options: ReadTarget): BranchAgentDatabaseReadOnlyScope {
  let scope = retainedScopes.paths.get(options.path);
  if (!scope) {
    scope = new BranchAgentDatabaseReadOnlyScope(true);
    scope.run(options, () => {});
    retainedScopes.paths.set(options.path, scope);
  }
  return scope;
}

/** Committed worker receipts invalidate projections on retained readers without running SQL. */
export function invalidateBranchAgentReadOnlyProjections(
  databaseIdentity: string,
  invalidate: (database: DatabaseSync) => void,
): void {
  for (const scope of retainedScopes.active) {
    scope.invalidateProjection(databaseIdentity, invalidate);
  }
}

/** Writable admission retires an idle reader before opening the same physical file. */
export function closeIdleBranchAgentDatabaseReadOnly(pathname: string): void {
  retainedScopes.paths.get(pathname)?.closeIfIdle();
}

export function retainCachedBranchAgentDatabaseReadOnly(options: ReadTarget) {
  return cachedScope(options).retain(options);
}

/** Reuse the caller's matching read scope, or this thread's idle-expiring reader. */
export function withScopedBranchAgentDatabaseReadOnly<T>(
  operation: (database: BranchAgentReadOnlyDatabase) => T,
  options: ReadTarget,
  behavior: BranchAgentDatabaseReadOnlyBehavior = {},
): BranchAgentDatabaseReadOnlyResult<T> {
  if (behavior.allowExtension) {
    return withFreshBranchAgentDatabaseReadOnly(operation, options, behavior);
  }
  const scope = readOnlyScope.getStore();
  return (scope?.matches(options.agentId, options.path) ? scope : cachedScope(options)).read(
    operation,
    options,
  );
}
