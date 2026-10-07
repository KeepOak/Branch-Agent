import { formatErrorMessage } from "../infra/errors.js";
import { BranchStateOwnershipError } from "../infra/sqlite-lifecycle-errors.js";
import { deferSqlitePostCommitPublication } from "../infra/sqlite-post-commit.js";
import { findStartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import { resolveGlobalSet } from "../shared/global-singleton.js";
import {
  isArtifactPreservingStateRead,
  withExistingBranchStateDatabaseReadOnly,
} from "../state/branch-state-db-readonly.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import {
  prepareConfigHealthPatch,
  readConfigHealthStateInDatabase,
  writeConfigHealthPatchInDatabase,
} from "./io.health-state.kernel.js";
import type {
  ConfigHealthEntryChanges,
  ConfigHealthState,
  ConfigHealthSnapshot,
} from "./io.health-state.types.js";
import { setBoundedConfigIoWarningEntry } from "./io.state.js";

type HealthObservation = {
  databasePath: string;
  configPath: string;
  identity: () => string | undefined;
};
const observations = resolveGlobalSet<HealthObservation>(
  Symbol.for("branch.configHealthObservations"),
  "close-and-restart",
);
const supersededObservation = new Error("Config health observation was superseded");
// Supersession uses identity; a process-lived import stack would retain its first caller.
supersededObservation.stack = undefined;

function matchingObservations(next: HealthObservation): HealthObservation[] {
  return [...observations].filter(
    (current) =>
      current.configPath === next.configPath &&
      (current.databasePath === next.databasePath ||
        (next.identity() !== undefined && current.identity() === next.identity())),
  );
}

function supersedeMatchingObservations(next: HealthObservation): void {
  for (const current of matchingObservations(next)) {
    observations.delete(current);
  }
}

/** Synchronous producers invalidate in-flight observations without retaining a scope. */
export function supersedeConfigHealthObservations(
  deps: ConfigHealthStateDeps,
  configPath: string,
): void {
  if (observations.size === 0) {
    return;
  }
  const env = resolveConfigHealthStateEnv(deps);
  const databasePath = resolveBranchStateSqlitePath(env);
  let context: ReturnType<typeof captureBranchStateWorkerContext> | undefined;
  try {
    context = captureBranchStateWorkerContext({ path: databasePath, env });
  } catch {
    // Native admission still owns synchronous diagnostics; a sealed read scope is already invalid.
  }
  supersedeMatchingObservations({
    databasePath,
    configPath,
    identity: () => context?.admission.identity.key,
  });
}

// Fresh config snapshots share a database; retain failures until a write recovers.
const loggedHealthWriteFailures = new Map<string, string>();

type ConfigHealthStateDeps = {
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  logger: Pick<typeof console, "warn">;
};

function resolveConfigHealthStateEnv(deps: ConfigHealthStateDeps): NodeJS.ProcessEnv {
  if (deps.env.BRANCH_HOME || deps.env.HOME || deps.env.USERPROFILE || deps.env.PREFIX) {
    return deps.env;
  }
  return { ...deps.env, HOME: deps.homedir() };
}

function handleHealthReadFailure(error: unknown): ConfigHealthState {
  if (error instanceof BranchStateOwnershipError) {
    throw error;
  }
  return {};
}

function handleHealthWriteFailure(
  deps: ConfigHealthStateDeps,
  databasePath: string,
  error: unknown,
): void {
  if (error instanceof BranchStateOwnershipError || findStartupMaintenanceRequiredError(error)) {
    throw error;
  }
  const message = formatErrorMessage(error);
  const repeated = loggedHealthWriteFailures.get(databasePath) === message;
  setBoundedConfigIoWarningEntry(loggedHealthWriteFailures, databasePath, message);
  if (!repeated) {
    deps.logger.warn(`Config health-state write failed: ${message}`);
  }
}

export function readConfigHealthStateFromStore(deps: ConfigHealthStateDeps): ConfigHealthState {
  try {
    return (
      withExistingBranchStateDatabaseReadOnly(({ db }) => readConfigHealthStateInDatabase(db), {
        env: resolveConfigHealthStateEnv(deps),
      }) ?? {}
    );
  } catch (error) {
    return handleHealthReadFailure(error);
  }
}

export function patchConfigHealthEntryToStore(
  deps: ConfigHealthStateDeps,
  configPath: string,
  changes: ConfigHealthEntryChanges,
): void {
  const env = resolveConfigHealthStateEnv(deps);
  const databasePath = resolveBranchStateSqlitePath(env);
  try {
    const patch = prepareConfigHealthPatch(changes);
    if (Object.keys(patch).length === 0) {
      return;
    }
    const updatedAtMs = Date.now();
    runBranchStateWriteTransaction(
      ({ db }) => {
        let pending: HealthObservation[] = [];
        if (observations.size > 0) {
          let context: ReturnType<typeof captureBranchStateWorkerContext> | undefined;
          try {
            context = captureBranchStateWorkerContext({ path: databasePath, env });
          } catch {
            // Maintenance may seal read admission while retaining the native writer.
          }
          pending = matchingObservations({
            databasePath,
            configPath,
            identity: () => context?.admission.identity.key,
          });
        }
        writeConfigHealthPatchInDatabase(db, configPath, patch, updatedAtMs);
        const publish = () => {
          for (const observation of pending) {
            observations.delete(observation);
          }
          loggedHealthWriteFailures.delete(databasePath);
        };
        if (!deferSqlitePostCommitPublication(db, publish)) {
          publish();
        }
      },
      { env, path: databasePath },
    );
  } catch (error) {
    handleHealthWriteFailure(deps, databasePath, error);
  }
}

type ConfigHealthStateStore = Disposable & {
  isCurrent(): boolean;
  captureContinuation(): ConfigHealthStateStore;
  read(): Promise<ConfigHealthSnapshot | null>;
  update(changes: ConfigHealthEntryChanges, previous: ConfigHealthSnapshot): Promise<void>;
  updateAfterFileCommit(
    changes: ConfigHealthEntryChanges,
    previous: ConfigHealthSnapshot,
  ): Promise<void>;
};

/** Bind one asynchronous observation/recovery to its original shared-state owner. */
export function captureConfigHealthStateStore(
  deps: ConfigHealthStateDeps,
  configPath: string,
  assertAdmissionCurrent?: () => void,
): ConfigHealthStateStore {
  const env = resolveConfigHealthStateEnv(deps);
  const databasePath = resolveBranchStateSqlitePath(env);
  let captured:
    | { context: ReturnType<typeof captureBranchStateWorkerContext> }
    | { error: unknown };
  try {
    captured = { context: captureBranchStateWorkerContext({ path: databasePath, env }) };
  } catch (error) {
    // Capture is eager, but failures retain the health owner's read/write policy.
    captured = { error };
  }
  const captureScope = (continuation = false): ConfigHealthStateStore => {
    assertAdmissionCurrent?.();
    const observation: HealthObservation = {
      databasePath,
      configPath,
      identity: () => ("context" in captured ? captured.context.admission.identity.key : undefined),
    };
    if (!continuation) {
      supersedeMatchingObservations(observation);
    }
    if (matchingObservations(observation).length === 0) {
      observations.add(observation);
    }
    const isCurrent = () => {
      assertAdmissionCurrent?.();
      if ("context" in captured) {
        captured.context.admission.assertCurrent();
      }
      return observations.has(observation);
    };
    const assertCurrent = () => {
      if (!isCurrent()) {
        throw supersededObservation;
      }
    };
    const createOperationGuard = () => {
      let guardFailed = false;
      return {
        rethrowIfInvalid: (error: unknown) => {
          if (guardFailed && error !== supersededObservation) {
            throw error;
          }
          try {
            isCurrent();
          } catch {
            throw error;
          }
        },
        assertCurrent: () => {
          try {
            assertCurrent();
          } catch (error) {
            guardFailed = true;
            throw error;
          }
        },
      };
    };
    const store: ConfigHealthStateStore = {
      isCurrent,
      captureContinuation: () => captureScope(true),
      [Symbol.dispose]() {
        observations.delete(observation);
      },
      async read(): Promise<ConfigHealthSnapshot | null> {
        const artifactPreserving = isArtifactPreservingStateRead();
        const guard = createOperationGuard();
        try {
          if ("error" in captured) {
            throw captured.error;
          }
          const snapshot = (await runBranchStateWorkerOperation(
            captured.context,
            (scope) => scope.execute({ type: "config.health.read", input: { artifactPreserving } }),
            { existingOnly: true, assertCurrent: guard.assertCurrent },
          )) ?? { state: {}, basis: {} };
          return isCurrent() ? snapshot : null;
        } catch (error) {
          guard.rethrowIfInvalid(error);
          if (error === supersededObservation) {
            return null;
          }
          const state = handleHealthReadFailure(error);
          return isCurrent() ? { state, basis: null } : null;
        }
      },
      async update(
        changes: ConfigHealthEntryChanges,
        previous: ConfigHealthSnapshot,
      ): Promise<void> {
        const guard = createOperationGuard();
        try {
          const patch = prepareConfigHealthPatch(changes);
          if (Object.keys(patch).length === 0) {
            return;
          }
          if ("error" in captured) {
            throw captured.error;
          }
          const prior = previous.basis?.[configPath];
          const expected = previous.basis === null ? undefined : prior ? { ...prior } : null;
          const updatedAtMs = Date.now();
          const applied = await runBranchStateWorkerOperation(
            captured.context,
            (scope) =>
              scope.execute({
                type: "config.health.patch",
                input: { configPath, patch, expected, updatedAtMs },
              }),
            { assertCurrent: guard.assertCurrent },
          );
          if (applied && observations.has(observation)) {
            loggedHealthWriteFailures.delete(databasePath);
          }
        } catch (error) {
          guard.rethrowIfInvalid(error);
          if (error === supersededObservation) {
            return;
          }
          handleHealthWriteFailure(deps, databasePath, error);
        }
      },
      async updateAfterFileCommit(changes, previous): Promise<void> {
        try {
          await store.update(changes, previous);
        } catch (error) {
          // Ownership and maintenance refusals still propagate after the file commits.
          handleHealthWriteFailure(deps, databasePath, error);
        }
      },
    };
    return store;
  };
  return captureScope();
}
