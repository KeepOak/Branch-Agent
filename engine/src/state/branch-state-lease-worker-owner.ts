import { isDeepStrictEqual } from "node:util";
import {
  collectNestedErrorCandidates,
  extractErrorCode,
} from "@branch/normalization-core/error-coercion";
import { isPromiseLike } from "@branch/normalization-core/promise-like";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { SqliteWorkerError } from "../infra/sqlite-worker-contract.js";
import {
  createSqliteWorkerOperationAdmission,
  type SqliteWorkerAdmissionFactory,
} from "../infra/sqlite-worker-operation-admission.js";
import type { SqliteWorkerOperationSettlement } from "../infra/sqlite-worker-operation-settlement.js";
import { createDeferredCore } from "../shared/deferred.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { BranchStateWorkerLeaseContext } from "./branch-state-lease-context.js";
import { BranchStateLeaseError } from "./branch-state-lease-error.js";
import type { BranchStateLeaseIdentity } from "./branch-state-lease.types.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";

export type BranchStateLeaseWorkerPurpose = "write" | "acquire" | "verify" | "renew" | "release";

export type BranchStateLeaseWorkerAuthority = {
  assertCurrent(this: void): void;
  beforeCommit?(this: void): void;
};

export type WorkerLeaseScope = {
  identity: BranchStateLeaseIdentity;
  assertCurrent(this: void): void;
  createAdmission: SqliteWorkerAdmissionFactory;
};
type WorkerLeasesScope = Omit<WorkerLeaseScope, "identity"> & {
  identities: readonly BranchStateLeaseIdentity[];
};
type RetainedLeaseScope = {
  identity: BranchStateLeaseIdentity;
  databasePath: string;
  assertCurrent(this: void): void;
  retainSettlement(settled: Promise<SqliteWorkerOperationSettlement>): void;
  settleNative(
    settled: Promise<SqliteWorkerOperationSettlement>,
    outcome: SqliteWorkerOperationSettlement,
  ): void;
  rethrowIfUncertain(failure: unknown, authorityError: unknown): void;
  finish(): void;
};
type WorkerLeaseOwner = {
  identity: BranchStateLeaseIdentity;
  sourceContext?: BranchStateWorkerContext;
  assertSourceCurrent(): void;
  retain(
    databasePath: string,
    purpose: BranchStateLeaseWorkerPurpose,
    authority?: BranchStateLeaseWorkerAuthority,
  ): RetainedLeaseScope;
  run<T>(
    databasePath: string,
    operation: (scope: WorkerLeaseScope) => Promise<T>,
    purpose: BranchStateLeaseWorkerPurpose,
    authority?: BranchStateLeaseWorkerAuthority,
  ): Promise<T>;
};
const owners = resolveGlobalSingleton(
  Symbol.for("branch.stateLeaseWorkerOwners"),
  () => new WeakMap<BranchStateWorkerLeaseContext, WorkerLeaseOwner>(),
);

function ownershipRefused(): never {
  throw new BranchStateLeaseError("State lease worker ownership was refused", {
    code: "BRANCH_STATE_LEASE_LOST",
  });
}

function assertSynchronousAuthority(assertion: (() => void) | undefined): void {
  const result: unknown = assertion?.();
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => {});
    throw new Error("State lease worker authority must complete synchronously");
  }
}

function captureLeaseWorkerSource(context: BranchStateWorkerContext, databasePath: string) {
  const { admission, maintenanceScope, runInCapturedSchemaScope, existingSchemaPath, environment } =
    context;
  const sourceEnvironment = { ...environment };
  const assertAdmission = admission.assertCurrent;
  const assertMaintenance = maintenanceScope?.assertAdmission;
  const assertMaintenanceOwner = maintenanceScope?.assertOwnerCurrent;
  return () => {
    if (
      context.admission !== admission ||
      admission.databasePath !== databasePath ||
      admission.assertCurrent !== assertAdmission ||
      context.maintenanceScope !== maintenanceScope ||
      maintenanceScope?.assertAdmission !== assertMaintenance ||
      maintenanceScope?.assertOwnerCurrent !== assertMaintenanceOwner ||
      context.runInCapturedSchemaScope !== runInCapturedSchemaScope ||
      context.existingSchemaPath !== existingSchemaPath ||
      context.environment !== environment ||
      !isDeepStrictEqual(environment, sourceEnvironment)
    ) {
      throw new Error("State lease worker source binding was replaced");
    }
    assertMaintenance?.();
    assertAdmission();
  };
}

function createLeaseAdmissionFactory(
  scopes: readonly RetainedLeaseScope[],
  purpose: BranchStateLeaseWorkerPurpose,
  assertCurrent: () => void,
  beforeCommit?: () => void,
  options: { plural?: boolean; expiryObservation?: SharedArrayBuffer } = {},
): SqliteWorkerAdmissionFactory {
  const firstScope = scopes[0];
  if (!firstScope) {
    throw new Error("State lease admission requires a retained owner");
  }
  return (retained) => {
    assertCurrent();
    // All original owners retain the same native outcome before a port can escape.
    for (const scope of scopes) {
      scope.retainSettlement(retained.settled);
    }
    void retained.settled.then((outcome) => {
      // Poison every participating owner in one turn before any release can observe settlement.
      for (const scope of scopes) {
        scope.settleNative(retained.settled, outcome);
      }
    });
    let writeStage: "waiting" | "transaction" | "commit" = "waiting";
    let lifecycleStage: "transaction" | "commit" | "settled" = "transaction";
    const lifecycleWrite = purpose === "acquire" || purpose === "renew" || purpose === "release";
    const expiryRequired = purpose === "write" || purpose === "verify" || purpose === "renew";
    return {
      nativeLocations: [...new Set(scopes.map((scope) => scope.databasePath))],
      admission: createSqliteWorkerOperationAdmission(
        (request, grant) => {
          assertCurrent();
          const facts = request.facts;
          const kind = options.plural
            ? "state-leases"
            : purpose === "write"
              ? "state-lease"
              : `state-lease-${purpose}`;
          if (
            (purpose === "write"
              ? writeStage === "commit" ||
                (options.plural && request.stage === "transaction" && writeStage !== "waiting") ||
                (request.stage !== "transaction" &&
                  !(request.stage === "commit" && writeStage === "transaction"))
              : lifecycleWrite
                ? request.stage !== lifecycleStage
                : request.stage !== "transaction") ||
            !isRecord(facts) ||
            facts.kind !== kind
          ) {
            ownershipRefused();
          }
          const members: unknown = options.plural ? facts.leases : [facts];
          if (!Array.isArray(members) || members.length !== scopes.length) {
            ownershipRefused();
          }
          const assertFacts = () => {
            const now = Date.now();
            for (const [index, scope] of scopes.entries()) {
              const member: unknown = members[index];
              if (
                !isRecord(member) ||
                !isDeepStrictEqual(member.identity, scope.identity) ||
                (expiryRequired &&
                  (typeof member.expiresAt !== "number" ||
                    !Number.isFinite(member.expiresAt) ||
                    member.expiresAt <= now))
              ) {
                ownershipRefused();
              }
            }
          };
          assertFacts();
          if (purpose === "write" && request.stage === "commit") {
            writeStage = "commit";
            beforeCommit?.();
            assertCurrent();
            // Synchronous host work can consume the worker's remaining lease lifetime.
            assertFacts();
          }
          if (grant()) {
            if (lifecycleWrite) {
              lifecycleStage = lifecycleStage === "transaction" ? "commit" : "settled";
            } else if (purpose === "write" && request.stage === "transaction") {
              writeStage = "transaction";
            }
          }
        },
        options.expiryObservation &&
          (purpose === "acquire" || purpose === "verify" || purpose === "renew")
          ? {
              kind: "state-lease-expiry",
              identity: firstScope.identity,
              observation: options.expiryObservation,
            }
          : undefined,
      ),
    };
  };
}

function runRetainedLeaseScopes<T>(
  scopes: readonly RetainedLeaseScope[],
  operation: () => Promise<T>,
): Promise<T> {
  const result = (async () => {
    try {
      const value = await operation();
      for (const scope of scopes) {
        scope.rethrowIfUncertain(undefined, undefined);
      }
      return value;
    } catch (failure) {
      for (const scope of scopes) {
        scope.rethrowIfUncertain(failure, undefined);
      }
      throw failure;
    } finally {
      for (const scope of scopes) {
        scope.finish();
      }
    }
  })();
  // Custody also owns abandoned failures; callers still receive the original rejecting result.
  void result.catch(() => {});
  return result;
}

/** Registered only by the actual lease owner, never reconstructed from a receipt. */
export function createBranchStateLeaseWorkerOwner(params: {
  lease?: BranchStateWorkerLeaseContext;
  identity: BranchStateLeaseIdentity;
  databasePath: string;
  sourceContext?: BranchStateWorkerContext;
  expiryObservation?: SharedArrayBuffer;
  assertCurrent(purpose: BranchStateLeaseWorkerPurpose): void;
}) {
  const assertSourceCurrent = params.sourceContext
    ? captureLeaseWorkerSource(params.sourceContext, params.databasePath)
    : undefined;
  const pending = new Set<Promise<unknown>>();
  const settlements = new Set<Promise<unknown>>();
  let accepting = true;
  let closed = false;
  let uncertain: { error: SqliteWorkerError } | undefined;
  const unknownOutcome = (cause: unknown) =>
    Object.assign(
      new SqliteWorkerError("State lease worker transaction outcome is unknown", "outcome-unknown"),
      { cause },
    );
  const assertCurrent = (purpose: BranchStateLeaseWorkerPurpose) => {
    if (uncertain) {
      throw uncertain.error;
    }
    if (closed) {
      throw new BranchStateLeaseError("State lease worker admission is closed", {
        code: "BRANCH_STATE_LEASE_LOST",
      });
    }
    params.assertCurrent(purpose);
  };
  const rethrowIfUncertain = (failure: unknown, authorityError: unknown): void => {
    const uncertainty =
      uncertain?.error ??
      collectNestedErrorCandidates(failure).find(
        (candidate) => extractErrorCode(candidate) === "outcome-unknown",
      );
    if (uncertainty === undefined) {
      return;
    }
    const errors = [
      ...new Set(
        [uncertainty, failure, ...(authorityError === undefined ? [] : [authorityError])].filter(
          (error) => error !== undefined,
        ),
      ),
    ];
    if (errors.length === 1) {
      throw uncertainty instanceof Error ? uncertainty : unknownOutcome(uncertainty);
    }
    throw unknownOutcome(
      createSqliteLifecycleAggregateError(
        errors,
        "state lease operation has an unknown write outcome",
        uncertainty,
      ),
    );
  };
  const owner: WorkerLeaseOwner = {
    identity: params.identity,
    sourceContext: params.sourceContext,
    assertSourceCurrent() {
      if (!assertSourceCurrent) {
        throw new Error("State leases require their original shared source context");
      }
      assertSourceCurrent();
    },
    retain(databasePath, purpose, authority) {
      const assertCaller = authority?.assertCurrent;
      assertCurrent(purpose);
      if (
        (!accepting && purpose !== "release" && purpose !== "verify") ||
        databasePath !== params.databasePath
      ) {
        throw new Error("State lease worker operation differs from its live owner");
      }
      const completion = createDeferredCore();
      pending.add(completion.promise);
      let active = true;
      return {
        identity: params.identity,
        databasePath: params.databasePath,
        assertCurrent() {
          assertCurrent(purpose);
          assertCaller?.();
          if (!active) {
            throw new Error("State lease worker operation has settled");
          }
        },
        retainSettlement(settled) {
          settlements.add(settled);
        },
        settleNative(settled, settlement) {
          if (settlement.kind === "unknown") {
            uncertain ??= { error: unknownOutcome(settlement.error) };
            accepting = false;
          }
          settlements.delete(settled);
        },
        rethrowIfUncertain,
        finish() {
          active = false;
          pending.delete(completion.promise);
          completion.resolve();
        },
      };
    },
    run(databasePath, operation, purpose, authority) {
      const beforeCommit = authority?.beforeCommit;
      const scope = owner.retain(databasePath, purpose, authority);
      return runRetainedLeaseScopes([scope], () =>
        operation({
          identity: { ...scope.identity },
          assertCurrent: scope.assertCurrent,
          createAdmission: createLeaseAdmissionFactory(
            [scope],
            purpose,
            scope.assertCurrent,
            beforeCommit,
            { expiryObservation: params.expiryObservation },
          ),
        }),
      );
    },
  };
  let boundLease = params.lease;
  if (boundLease) {
    owners.set(boundLease, owner);
  }
  const settle = async () => {
    accepting = false;
    await Promise.allSettled(pending);
    await Promise.allSettled(settlements);
  };
  return {
    bind(lease: BranchStateWorkerLeaseContext) {
      if (closed || boundLease) {
        throw new Error("State lease worker owner is already bound or closed");
      }
      boundLease = lease;
      owners.set(lease, owner);
    },
    runLifecycle<T>(
      purpose: "acquire" | "verify" | "renew" | "release",
      operation: (scope: WorkerLeaseScope) => Promise<T>,
    ): Promise<T> {
      return owner.run(params.databasePath, operation, purpose);
    },
    run<T>(operation: () => Promise<T>): Promise<T> {
      return owner.run(params.databasePath, operation, "write");
    },
    canRelease: () => pending.size === 0 && settlements.size === 0 && !uncertain,
    settle,
    rethrowIfUncertain,
    async drain() {
      await settle();
      if (uncertain) {
        throw uncertain.error;
      }
    },
    close() {
      accepting = false;
      closed = true;
      if (boundLease) {
        owners.delete(boundLease);
      }
    },
  };
}

export function withBranchStateLeaseWorkerAdmission<T>(
  lease: BranchStateWorkerLeaseContext,
  databasePath: string,
  operation: (scope: WorkerLeaseScope) => Promise<T>,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<T> {
  const owner = owners.get(lease);
  if (!owner) {
    throw new Error("State lease worker operation requires its original live lease context");
  }
  return owner.run(databasePath, operation, "write", authority);
}

/** Multiple leases authorize one worker operation only from their shared captured source. */
export function withBranchStateLeasesWorkerAdmission<T>(
  leases: readonly BranchStateWorkerLeaseContext[],
  context: BranchStateWorkerContext,
  operation: (scope: WorkerLeasesScope) => Promise<T>,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<T> {
  if (leases.length === 0) {
    throw new Error("State lease worker operation requires at least one live lease");
  }
  const assertCaller = authority?.assertCurrent;
  const beforeCommit = authority?.beforeCommit;
  const selected = leases.map((lease) => {
    const owner = owners.get(lease);
    if (!owner || owner.sourceContext !== context) {
      throw new Error("State leases require their original shared source context");
    }
    return owner;
  });
  const keys = new Set(
    selected.map(({ identity }) => JSON.stringify([identity.scope, identity.key])),
  );
  if (new Set(selected).size !== selected.length || keys.size !== selected.length) {
    throw new Error("State lease worker operation contains duplicate leases");
  }
  const scopes: RetainedLeaseScope[] = [];
  const assertCurrent = () => {
    assertSynchronousAuthority(assertCaller);
    for (const scope of scopes) {
      scope.assertCurrent();
    }
    for (const owner of selected) {
      owner.assertSourceCurrent();
    }
  };
  try {
    for (const owner of selected) {
      scopes.push(owner.retain(context.admission.databasePath, "write"));
    }
    assertCurrent();
  } catch (error) {
    for (const scope of scopes) {
      scope.finish();
    }
    throw error;
  }
  return runRetainedLeaseScopes(scopes, () =>
    operation({
      identities: scopes.map(({ identity }) => ({ ...identity })),
      assertCurrent,
      createAdmission: createLeaseAdmissionFactory(
        scopes,
        "write",
        assertCurrent,
        () => assertSynchronousAuthority(beforeCommit),
        { plural: true },
      ),
    }),
  );
}
