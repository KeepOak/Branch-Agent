import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import { resolveIdentityPathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export type MaintenanceResource = {
  phase:
    | "agent-resources"
    | "agent-handles"
    | "shared-leases"
    | "shared-resources"
    | "shared-references"
    | "shared-handles";
  close: () => void | Promise<void>;
};

export type AgentSchemaMigration = {
  agentId: string;
  path: string;
  foundVersion: number;
  supportedVersion: number;
};

export type BranchDatabaseMaintenanceScope = {
  readonly ownsSchemaMaintenance: boolean;
  assertOwnerCurrent(this: void, access?: "read"): void;
  assertDatabaseAccess(this: void, databasePath: string): void;
  assertAdmission(this: void): void;
  assertReadAdmission(this: void): void;
  addAgentSchemaMigrationCheck(check: (migration: AgentSchemaMigration) => void): void;
  assertAgentSchemaMigration(migration: AgentSchemaMigration): void;
  run<T>(operation: () => T): T;
  track<T>(operation: Promise<T>): Promise<T>;
  own(
    resource: object,
    phase: MaintenanceResource["phase"],
    close: MaintenanceResource["close"],
  ): void;
  close(beforeResources?: () => void | Promise<void>): Promise<void>;
};

const liveAuthorityReads = resolveGlobalSingleton(
  Symbol.for("branch.maintenanceLiveAuthorityReads"),
  () => new WeakMap<BranchDatabaseMaintenanceScope, Set<string>>(),
);

export function allowsMaintenanceLiveAuthorityReads(
  scope: BranchDatabaseMaintenanceScope,
  pathname: string,
): boolean {
  const canonicalPath = resolveIdentityPathViaExistingAncestorSync(pathname);
  for (
    let current: BranchDatabaseMaintenanceScope | undefined = scope;
    current;
    current = maintenanceResources.parents.get(current)
  ) {
    if (liveAuthorityReads.get(current)?.has(canonicalPath)) {
      return true;
    }
  }
  return false;
}

/** Raw source descriptor closes are safe only before maintenance admits native source reads. */
export function maintenanceOwnerHasSourceCustody(
  scope: BranchDatabaseMaintenanceScope | undefined,
  pathname: string,
): boolean {
  if (!scope?.ownsSchemaMaintenance) {
    return false;
  }
  scope.assertReadAdmission();
  return !allowsMaintenanceLiveAuthorityReads(scope, pathname);
}

const MAINTENANCE_IN_PROCESS_COPY_MAX_BYTES = 64 * 1024 * 1024;

export function maintenanceOwnerMayCopySourcesInProcess(
  scope: BranchDatabaseMaintenanceScope | undefined,
  pathname: string,
): boolean {
  if (!maintenanceOwnerHasSourceCustody(scope, pathname)) {
    return false;
  }
  // Larger families keep the cancellable isolated child so a slow copy cannot pin Doctor's main thread.
  let bytes = 0;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    bytes += fs.statSync(`${pathname}${suffix}`, { throwIfNoEntry: false })?.size ?? 0;
    if (bytes > MAINTENANCE_IN_PROCESS_COPY_MAX_BYTES) {
      return false;
    }
  }
  return true;
}

export const maintenanceResources = resolveGlobalSingleton(
  Symbol.for("branch.databaseMaintenanceResources"),
  () => ({
    current: new AsyncLocalStorage<{ scope: BranchDatabaseMaintenanceScope; active: boolean }>(),
    claims: new WeakMap<
      object,
      MaintenanceResource & { scope: BranchDatabaseMaintenanceScope; release: () => void }
    >(),
    parents: new WeakMap<BranchDatabaseMaintenanceScope, BranchDatabaseMaintenanceScope>(),
  }),
);

export function getBranchDatabaseMaintenanceScope():
  | BranchDatabaseMaintenanceScope
  | undefined {
  return maintenanceResources.current.getStore()?.scope;
}

/** Doctor selects live source reads only after its pre-mutation backup boundary. */
export function admitBranchMaintenanceLiveAuthorityReads(pathname: string): void {
  const scope = getBranchDatabaseMaintenanceScope();
  if (!scope?.ownsSchemaMaintenance) {
    throw new Error("Live authority reads require database maintenance ownership");
  }
  scope.assertDatabaseAccess(pathname);
  let admitted = liveAuthorityReads.get(scope);
  if (!admitted) {
    admitted = new Set();
    liveAuthorityReads.set(scope, admitted);
  }
  admitted.add(resolveIdentityPathViaExistingAncestorSync(pathname));
}

/** Delayed work acquires its own resources instead of inheriting the completed scope. */
export function runOutsideBranchDatabaseMaintenanceScope<T>(operation: () => T): T {
  return maintenanceResources.current.exit(operation);
}

export function isBranchDatabaseMaintenanceResourceOwned(
  resource: object,
  scope: BranchDatabaseMaintenanceScope,
): boolean {
  return maintenanceResources.claims.get(resource)?.scope === scope;
}

export function getBranchDatabaseMaintenanceResourceScope(
  resource: object,
): BranchDatabaseMaintenanceScope | undefined {
  return maintenanceResources.claims.get(resource)?.scope;
}

export function runMaintenance<T>(scope: BranchDatabaseMaintenanceScope, operation: () => T): T {
  const accepted = { scope, active: true };
  try {
    const result = maintenanceResources.current.run(accepted, operation);
    if (result instanceof Promise) {
      const settled = () => {
        accepted.active = false;
      };
      void result.then(settled, settled);
      void scope.track(result);
    } else {
      accepted.active = false;
    }
    return result;
  } catch (error) {
    accepted.active = false;
    throw error;
  }
}

/** Retain one exact resource claim for finite commands while its maintenance scope drains. */
export function captureBranchDatabaseMaintenanceResource(
  resource: object,
  expectedScope: BranchDatabaseMaintenanceScope,
) {
  const claim = maintenanceResources.claims.get(resource);
  const assertCurrent = () => {
    expectedScope.assertOwnerCurrent();
    if (claim?.scope !== expectedScope || maintenanceResources.claims.get(resource) !== claim) {
      throw new Error("Database maintenance resource owner changed");
    }
  };
  assertCurrent();
  return {
    assertCurrent,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      assertCurrent();
      return runMaintenance(expectedScope, operation);
    },
  };
}

/** A cached handle used by an independent caller remains with the ordinary cache owner. */
export function observeBranchDatabaseMaintenanceResource(resource: object | undefined): void {
  if (!resource) {
    return;
  }
  const claim = maintenanceResources.claims.get(resource);
  const current = getBranchDatabaseMaintenanceScope();
  if (!claim) {
    return;
  }
  const owner = commonMaintenanceAncestor(claim.scope, current);
  if (owner === claim.scope) {
    return;
  }
  claim.scope.assertAdmission();
  claim.release();
  maintenanceResources.claims.delete(resource);
  if (owner) {
    owner.own(resource, claim.phase, claim.close);
  }
}

function commonMaintenanceAncestor(
  owner: BranchDatabaseMaintenanceScope,
  scope: BranchDatabaseMaintenanceScope | undefined,
): BranchDatabaseMaintenanceScope | undefined {
  const ancestors = new Set<BranchDatabaseMaintenanceScope>();
  for (
    let current: BranchDatabaseMaintenanceScope | undefined = owner;
    current;
    current = maintenanceResources.parents.get(current)
  ) {
    ancestors.add(current);
  }
  for (let current = scope; current; current = maintenanceResources.parents.get(current)) {
    if (ancestors.has(current)) {
      return current;
    }
  }
  return undefined;
}
