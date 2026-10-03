import type { DatabaseSync } from "node:sqlite";
import { isMainThread } from "node:worker_threads";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { assertSqliteIntegrityInWorker } from "../infra/sqlite-integrity-worker.js";
import {
  runSqliteIntegrityCheckSync,
  runSqliteIntegrityOperationSync,
  type SqliteIntegrityCheck,
  type SqliteIntegrityOperation,
} from "../infra/sqlite-integrity.js";
import { registerDeferredSqliteWalWriteAdmission } from "../infra/sqlite-wal-write-admission.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { createDeferredCore } from "../shared/deferred.js";
import { assertAgentDatabaseAdmitted } from "./agent-database-admission.js";
import {
  assertAgentDeletionDatabaseCleanupAccess,
  getAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
  BranchAgentDatabaseRegistrationObserver,
} from "./branch-agent-db-contract.js";
import type { prepareBranchAgentDatabaseWorkerLease } from "./branch-agent-db-lease.js";
import {
  agentDatabaseLifecycle as cache,
  retainAgentDatabase,
  type PendingAgentDatabaseOpen,
} from "./branch-agent-db-lifecycle.js";
import {
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./branch-agent-db-schema-helpers.js";
import type { BranchAgentDatabaseValidation } from "./branch-agent-db-validation-cache.js";
import { resolveBranchAgentSqlitePath } from "./branch-agent-db.paths.js";
import {
  getBranchDatabaseMaintenanceScope,
  observeBranchDatabaseMaintenanceResource,
} from "./branch-state-db-async-lifecycle.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db-contract.js";

/** Denial still invokes run under admission, with a throwing authority check, to permit cleanup. */
export type BranchAgentDatabaseWriteAdmission = <T>(
  run: (assertCurrent: () => void, validation?: BranchAgentDatabaseValidation) => T | Promise<T>,
) => Promise<T>;

/** Refusal must unwind ownership without entering corruption repair or changing its caller error. */
function assertAgentDatabaseOpenAuthority(
  operation: SqliteIntegrityOperation<BranchAgentDatabase>,
  assertCurrent?: () => void,
): void {
  try {
    assertCurrent?.();
  } catch (error) {
    const refusal = new Error("Agent database open authority was refused", { cause: error });
    try {
      operation.throw(refusal);
    } catch (cleanupError) {
      if (cleanupError !== refusal) {
        throw new AggregateError(
          [error, cleanupError],
          `Agent database authority and cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          {
            cause: cleanupError,
          },
        );
      }
    }
    throw error;
  }
}

function assertAgentDatabaseOperationCurrent(
  database: BranchAgentDatabase,
  options: BranchAgentDatabaseOptions,
  pending: PendingAgentDatabaseOpen,
  assertCurrent?: () => void,
): void {
  pending.controller.signal.throwIfAborted();
  assertAgentDatabaseAdmitted(database.agentId, { env: options.env });
  if (cache.databases.get(pending.path) !== database || !database.db.isOpen) {
    throw new Error(`Agent database closed before its admitted operation: ${pending.path}`);
  }
  // Coalesced callers keep their own scope; admission cannot lend its cleanup authority.
  assertAgentDeletionDatabaseCleanupAccess(database, options);
  assertCurrent?.();
}

/** Bind admission drivers to the canonical private database-open generator. */
export function createBranchAgentDatabaseAdmissionOwner(
  openSteps: (
    options: BranchAgentDatabaseOptions,
    pending?: PendingAgentDatabaseOpen,
    preparedLease?: ReturnType<typeof prepareBranchAgentDatabaseWorkerLease>,
    registrationObserver?: BranchAgentDatabaseRegistrationObserver,
  ) => SqliteIntegrityOperation<BranchAgentDatabase>,
) {
  /** Open or return a cached per-agent database after schema and owner validation. */
  function openBranchAgentDatabase(
    options: BranchAgentDatabaseOptions,
    preparedLease?: ReturnType<typeof prepareBranchAgentDatabaseWorkerLease>,
    registrationObserver?: BranchAgentDatabaseRegistrationObserver,
  ): BranchAgentDatabase {
    const run = () => {
      const steps = openSteps(options, undefined, preparedLease, registrationObserver);
      return runSqliteIntegrityOperationSync(
        steps,
        preparedLease && !isMainThread
          ? () =>
              assertAgentDatabaseOpenAuthority(steps, () =>
                requestSqliteWorkerOperationAdmission({
                  stage: "prepare",
                  facts: { kind: "agent-open-resume", lease: preparedLease.receipt },
                }),
              )
          : undefined,
      );
    };
    const scope = getBranchDatabaseMaintenanceScope();
    return scope ? scope.run(run) : run();
  }

  /** The initiating caller guards its physical open; each coalesced caller guards its own operation. */
  function withBranchAgentDatabaseAsync<T>(
    inputOptions: BranchAgentDatabaseOptions,
    operation: (database: BranchAgentDatabase) => T | Promise<T>,
    /** Synchronous live authority for the initiating open and this caller's operation. */
    assertCurrent?: () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    const run = () => runAgentDatabaseAsync(inputOptions, operation, assertCurrent, signal);
    const scope = getBranchDatabaseMaintenanceScope();
    return scope ? scope.run(run) : run();
  }

  function runAgentDatabaseAsync<T>(
    inputOptions: BranchAgentDatabaseOptions,
    operation: (database: BranchAgentDatabase) => T | Promise<T>,
    assertCurrent?: () => void,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      signal?.throwIfAborted();
      assertCurrent?.();
    } catch (error) {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Caller assertions retain their original thrown value.
      return Promise.reject(error);
    }
    // Admission retains its original path, registration, and permission inputs across awaits.
    const options = {
      ...inputOptions,
      env: cloneEnvWithPlatformSemantics(inputOptions.env ?? process.env),
    };
    const agentId = normalizeAgentId(options.agentId);
    const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
    const existing = cache.pending.get(pathname);
    if (existing?.agentId !== undefined && existing.agentId !== agentId) {
      return Promise.reject(
        new Error(`Agent database ${pathname} is opening for ${existing.agentId}`),
      );
    }
    if (existing?.controller.signal.aborted) {
      return existing.promise.then(
        () => withBranchAgentDatabaseAsync(options, operation, assertCurrent, signal),
        () => withBranchAgentDatabaseAsync(options, operation, assertCurrent, signal),
      );
    }
    const pending =
      existing ?? startBranchAgentDatabaseAdmission(options, agentId, pathname, assertCurrent);
    pending.operations += 1;
    const work = racePromiseWithAbortSignal(pending.promise, signal)
      .then((database) => {
        signal?.throwIfAborted();
        assertAgentDatabaseOperationCurrent(database, options, pending, assertCurrent);
        observeBranchDatabaseMaintenanceResource(database.db);
        return operation(database);
      })
      .finally(() => {
        // Every registered operation retains the publication borrow through its own
        // settlement, including wrapper/adoption awaits before it reaches the writer.
        pending.operations -= 1;
        if (!pending.operations) {
          // The physical owner survives one stopped waiter, but not the last one.
          if (!pending.releaseBorrow) {
            pending.controller.abort(new Error("Agent database admission has no waiting callers"));
          }
          pending.releaseBorrow?.();
        }
      });
    return work;
  }

  /** Run on a Worker to keep its same-connection integrity check outside the parent writer. */
  function withBranchAgentDatabaseAdmission<T>(
    inputOptions: BranchAgentDatabaseOptions,
    withAdmission: BranchAgentDatabaseWriteAdmission,
    operation: (database: BranchAgentDatabase) => T | Promise<T>,
  ): Promise<T> {
    const run = () => runAgentDatabaseAdmission(inputOptions, withAdmission, operation);
    const scope = getBranchDatabaseMaintenanceScope();
    return scope ? scope.run(() => scope.track(run())) : run();
  }

  async function runAgentDatabaseAdmission<T>(
    inputOptions: BranchAgentDatabaseOptions,
    withAdmission: BranchAgentDatabaseWriteAdmission,
    operation: (database: BranchAgentDatabase) => T | Promise<T>,
  ): Promise<T> {
    const options = {
      ...inputOptions,
      env: cloneEnvWithPlatformSemantics(inputOptions.env ?? process.env),
    };
    const agentId = normalizeAgentId(options.agentId);
    const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
    const existing = cache.pending.get(pathname);
    if (existing) {
      if (existing.agentId !== agentId) {
        throw new Error(`Agent database ${pathname} is opening for ${existing.agentId}`);
      }
      try {
        await existing.promise;
      } catch (error) {
        if (!existing.controller.signal.aborted) {
          throw error;
        }
      }
      return withBranchAgentDatabaseAdmission(options, withAdmission, operation);
    }
    const admission = createBranchAgentDatabaseAdmission(agentId, pathname);
    const { pending } = admission;
    // This caller receives its scoped operation result; lifecycle disposal joins the open promise.
    void pending.promise.catch(() => {});
    pending.operations += 1;
    const steps = openSteps(options, pending);
    let check: SqliteIntegrityCheck | undefined;
    let failure: { error: unknown } | undefined;
    let suspended = false;
    try {
      while (true) {
        const outcome = await withAdmission(async (assertCurrent, validation) => {
          suspended = false;
          assertAgentDatabaseOpenAuthority(steps, () => {
            assertCurrent();
            assertBranchAgentDatabaseAdmissionCurrent(options, pending, check?.database);
          });
          pending.validation = validation;
          const step = failure ? steps.throw(failure.error) : steps.next();
          if (!step.done) {
            suspended = true;
            return { done: false as const, check: step.value };
          }
          pending.releaseBorrow = retainAgentDatabase(step.value.db);
          admission.complete(step.value);
          const assertOperationCurrent = () =>
            assertAgentDatabaseOperationCurrent(step.value, options, pending, assertCurrent);
          assertOperationCurrent();
          const flushMaintenance = isMainThread
            ? undefined
            : registerDeferredSqliteWalWriteAdmission(step.value.db);
          flushMaintenance?.(assertOperationCurrent);
          const result = await operation(step.value);
          flushMaintenance?.(assertOperationCurrent);
          return { done: true as const, result };
        });
        if (outcome.done) {
          return outcome.result;
        }
        check = outcome.check;
        failure = undefined;
        try {
          pending.controller.signal.throwIfAborted();
          runSqliteIntegrityCheckSync(check);
        } catch (error) {
          failure = { error };
        }
      }
    } catch (error) {
      const failures = [error];
      if (suspended) {
        const cancellation = new Error(`Agent database admission failed: ${pathname}`, {
          cause: error,
        });
        try {
          // A lost scheduler cannot grant another permit. A generic refusal only
          // unwinds this owner's handle and lease; it cannot enter index repair.
          steps.throw(cancellation);
        } catch (cleanupError) {
          if (cleanupError !== cancellation) {
            failures.push(cleanupError);
          }
        }
      }
      const terminalFailure =
        failures.length === 1
          ? error
          : new AggregateError(failures, "Agent database admission and cleanup failed", {
              cause: error,
            });
      admission.fail(terminalFailure);
      throw terminalFailure;
    } finally {
      pending.operations -= 1;
      if (!pending.operations) {
        pending.releaseBorrow?.();
      }
    }
  }

  function createBranchAgentDatabaseAdmission(agentId: string, pathname: string) {
    const completion = createDeferredCore<BranchAgentDatabase>();
    const pending: PendingAgentDatabaseOpen = {
      agentId,
      path: pathname,
      controller: new AbortController(),
      promise: completion.promise,
      operations: 0,
    };
    cache.pending.set(pathname, pending);
    cache.activePending.add(pending);
    const retire = () => {
      if (cache.pending.get(pathname) === pending) {
        cache.pending.delete(pathname);
      }
      cache.activePending.delete(pending);
    };
    return {
      pending,
      complete: (database: BranchAgentDatabase) => {
        retire();
        if (
          pending.controller.signal.aborted ||
          cache.databases.get(pathname) !== database ||
          !database.db.isOpen
        ) {
          const error =
            pending.controller.signal.reason ??
            new Error(`Agent database closed before admission completed: ${pathname}`);
          completion.reject(error);
          throw error;
        }
        completion.resolve(database);
      },
      fail: (error: unknown) => {
        retire();
        completion.reject(error);
      },
    };
  }

  function assertBranchAgentDatabaseAdmissionCurrent(
    options: BranchAgentDatabaseOptions,
    pending: PendingAgentDatabaseOpen,
    database?: DatabaseSync,
  ): void {
    const pathname = pending.path;
    pending.controller.signal.throwIfAborted();
    assertAgentDatabaseAdmitted(pending.agentId, { env: options.env });
    if (cache.pending.get(pathname) !== pending) {
      throw new Error(`Agent database open was replaced: ${pathname}`);
    }
    // Cleanup may end during the native check; reject before schema repair can resume.
    getAgentDeletionDatabaseCleanup(options)?.assertCurrent();
    pending.assertHeld?.();
    if (database) {
      assertSupportedAgentSchemaVersion(database, pathname);
      assertExistingAgentSchemaOwner(
        readExistingAgentSchemaMeta(database),
        pending.agentId,
        pathname,
      );
    }
  }

  function startBranchAgentDatabaseAdmission(
    options: BranchAgentDatabaseOptions,
    agentId: string,
    pathname: string,
    assertCurrent?: () => void,
  ): PendingAgentDatabaseOpen {
    const admission = createBranchAgentDatabaseAdmission(agentId, pathname);
    const { pending } = admission;
    const operation = openSteps(options, pending);
    void (async () => {
      assertAgentDatabaseOpenAuthority(operation, assertCurrent);
      let step = operation.next();
      while (!step.done) {
        const database = step.value.database;
        let failure: unknown;
        let failed = false;
        try {
          await assertSqliteIntegrityInWorker(
            pathname,
            BRANCH_SQLITE_BUSY_TIMEOUT_MS,
            pending.controller.signal,
            undefined,
            step.value.timing,
            step.value.tables,
          );
        } catch (error) {
          failure = error;
          failed = true;
        }
        // Throwing an integrity verdict into the generator can repair indexes too.
        assertAgentDatabaseOpenAuthority(operation, () => {
          assertBranchAgentDatabaseAdmissionCurrent(options, pending, database);
          assertCurrent?.();
        });
        // Resuming, or throwing into, the same owner preserves repair and unwind policy.
        step = failed ? operation.throw(failure) : operation.next();
      }
      // A peer may publish before promise consumers run. Their operation owner,
      // not promise scheduling depth, releases this exact connection borrow.
      pending.releaseBorrow = retainAgentDatabase(step.value.db);
      return step.value;
    })()
      .then(admission.complete, admission.fail)
      .catch(admission.fail);
    return pending;
  }

  return {
    openBranchAgentDatabase,
    withBranchAgentDatabaseAsync,
    withBranchAgentDatabaseAdmission,
  };
}
