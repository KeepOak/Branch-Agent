import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { mergeProcessEnv } from "../infra/process-env.js";
import { getBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";
import { captureBranchStateSchemaReadAdmission } from "./branch-state-db-schema-policy.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";

/** Capture read authority without constructing a worker environment. */
export function captureBranchStateReadContextWithAdmission(
  pathname: string,
  captureAdmission: (pathname: string) => BranchStateWorkerContext["admission"],
): Pick<
  BranchStateWorkerContext,
  "admission" | "maintenanceScope" | "existingSchemaPath" | "runInCapturedSchemaScope"
> {
  const schema = captureBranchStateSchemaReadAdmission(pathname);
  const capturedAdmission = captureAdmission(pathname);
  let admission = capturedAdmission;
  let runInCapturedSchemaScope: BranchStateWorkerContext["runInCapturedSchemaScope"];
  if (schema) {
    const inCapturedScope = AsyncLocalStorage.snapshot();
    admission = {
      databasePath: capturedAdmission.databasePath,
      coordinationKey: capturedAdmission.coordinationKey,
      get identity() {
        return capturedAdmission.identity;
      },
      assertCurrent() {
        capturedAdmission.assertCurrent();
        schema.assertCurrent();
      },
    };
    runInCapturedSchemaScope = (operation) =>
      inCapturedScope(() => {
        admission.assertCurrent();
        return operation();
      });
  }
  return {
    maintenanceScope: getBranchDatabaseMaintenanceScope(),
    admission,
    existingSchemaPath: schema?.path,
    runInCapturedSchemaScope,
  };
}

/** Read-only workers need resolved runtime facts, not the initialization environment. */
export function captureBranchStateReadWorkerContextWithAdmission(
  options: { path?: string; env?: NodeJS.ProcessEnv },
  captureAdmission: (pathname: string) => BranchStateWorkerContext["admission"],
): BranchStateWorkerContext {
  const source = options.env ?? process.env;
  const env = process.platform === "win32" ? cloneEnvWithPlatformSemantics(source) : source;
  const environment: BranchStateWorkerContext["environment"] = {
    BRANCH_STATE_DIR: resolveStateDir(env),
    ...(isGatewayExternallySupervised(env) ? { BRANCH_SUPERVISOR_MODE: "external" } : {}),
  };
  return {
    ...captureBranchStateReadContextWithAdmission(
      options.path ?? resolveBranchStateSqlitePath(environment),
      captureAdmission,
    ),
    environment,
  };
}

/** Capture host facts before asynchronous work, without opening SQLite. */
export function captureBranchStateWorkerContextWithAdmission(
  options: {
    path?: string;
    env?: NodeJS.ProcessEnv;
    initializationAgentPaths?: readonly string[];
  },
  captureAdmission: (pathname: string) => BranchStateWorkerContext["admission"],
): BranchStateWorkerContext {
  const context = captureBranchStateReadWorkerContextWithAdmission(options, captureAdmission);
  return {
    ...context,
    initializationEnvironment: mergeProcessEnv([
      options.env ?? process.env,
      { BRANCH_STATE_DIR: undefined, BRANCH_SUPERVISOR_MODE: undefined },
      context.environment,
    ]),
    ...(options.initializationAgentPaths
      ? {
          initializationAgentPaths: options.initializationAgentPaths.map((agentPath) =>
            path.resolve(agentPath),
          ),
        }
      : {}),
  };
}
