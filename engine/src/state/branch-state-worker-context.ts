import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import { isStateDatabaseReadAdmissionInvalidatedError } from "./branch-state-db-async-lifecycle.js";
import { captureBranchStateDatabaseReadAdmission } from "./branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import {
  captureBranchStateReadContextWithAdmission,
  captureBranchStateReadWorkerContextWithAdmission,
  captureBranchStateWorkerContextWithAdmission,
} from "./branch-state-worker-context.capture.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";

export type BranchStateReadContext = ReturnType<
  typeof captureBranchStateReadContextWithAdmission
>;

/** Capture read authority without constructing a worker environment. */
export function captureBranchStateReadContext(
  pathname = resolveBranchStateSqlitePath(),
): BranchStateReadContext {
  return captureBranchStateReadContextWithAdmission(
    pathname,
    captureBranchStateDatabaseReadAdmission,
  );
}

/** Read-only workers need resolved runtime facts, not the initialization environment. */
export function captureBranchStateReadWorkerContext(
  options: { path?: string; env?: NodeJS.ProcessEnv } = {},
): BranchStateWorkerContext {
  return captureBranchStateReadWorkerContextWithAdmission(
    options,
    captureBranchStateDatabaseReadAdmission,
  );
}

/** Resident readers retain their source and schema policy without re-admitting each publication. */
export function prepareBranchStateReadSource(input: { path: string; env?: NodeJS.ProcessEnv }) {
  const env = cloneEnvWithPlatformSemantics(input.env ?? process.env);
  env.BRANCH_STATE_DIR = resolveStateDir(env);
  const options = { path: path.resolve(input.path), env };
  const inSourceContext = AsyncLocalStorage.snapshot();
  const original = captureBranchStateReadContext(options.path);
  let context = original;
  let worker: BranchStateWorkerContext | undefined;

  const refresh = () => {
    original.maintenanceScope?.assertAdmission();
    const identity = original.admission.identity;
    if (identity.key.startsWith("file:")) {
      assertExistingDatabaseIdentity(options.path, identity.key, identity.birthtime);
    } else {
      original.admission.assertCurrent();
    }
    const next = captureBranchStateReadContext(options.path);
    const source = original.admission.identity;
    if (
      next.admission.identity.key !== source.key ||
      next.admission.identity.birthtime !== source.birthtime ||
      next.maintenanceScope !== original.maintenanceScope ||
      next.existingSchemaPath !== original.existingSchemaPath
    ) {
      throw new Error("Prepared state read source changed before read admission");
    }
    return (context = next);
  };
  const current = () => {
    context.maintenanceScope?.assertAdmission();
    try {
      context.admission.assertCurrent();
      if (context.admission.identity.key.startsWith("file:")) {
        return context;
      }
    } catch (error) {
      if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
        throw error;
      }
    }
    return inSourceContext(refresh);
  };
  const prepareWorker = () => {
    // Actual reads verify the file even when no local publication revoked its admission.
    const next = refresh();
    worker ??= captureBranchStateWorkerContext(options);
    if (worker.admission !== next.admission) {
      worker = { ...worker, ...next };
    }
    return worker;
  };
  return {
    current,
    workerContext: () => inSourceContext(prepareWorker),
    withCurrent<T>(consume: (context: BranchStateWorkerContext) => T): T {
      return inSourceContext(() => consume(prepareWorker()));
    },
  };
}

export function captureBranchStateWorkerContext(
  options: Parameters<typeof captureBranchStateWorkerContextWithAdmission>[0] = {},
): BranchStateWorkerContext {
  return captureBranchStateWorkerContextWithAdmission(
    options,
    captureBranchStateDatabaseReadAdmission,
  );
}
