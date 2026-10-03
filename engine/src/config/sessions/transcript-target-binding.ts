import path from "node:path";
import { isGatewayExternallySupervised } from "../../infra/gateway-supervision.js";
import type { SqliteWorkerStateContext } from "../../infra/sqlite-worker-state-context.js";
import { cloneEnvWithPlatformSemantics } from "../config-env-vars.js";
import { resolveStateDir } from "../state-dir.js";
import type { SessionTranscriptRuntimeTarget } from "./session-accessor.types.js";

type StorageEnvironment = Readonly<SqliteWorkerStateContext["environment"]>;

const storageEnvironmentKeys = new Set([
  "BRANCH_STATE_DIR",
  "BRANCH_SUPERVISOR_MODE",
  "BRANCH_HOME",
  "HOME",
  "USERPROFILE",
  "PREFIX",
  "ANDROID_DATA",
  "BRANCH_TEST_FAST",
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
  "NODE_ENV",
]);

export type SessionTranscriptTargetBinding = SessionTranscriptRuntimeTarget & {
  env?: StorageEnvironment;
};

/** Retain storage routing facts without retaining caller credentials. */
export function captureSessionTranscriptStorageEnvironment(
  source: NodeJS.ProcessEnv,
): StorageEnvironment {
  const env = cloneEnvWithPlatformSemantics(
    Object.fromEntries(
      Object.keys(source)
        .filter((key) => storageEnvironmentKeys.has(key.toUpperCase()))
        .map((key) => [key, source[key]]),
    ),
  );
  return {
    BRANCH_STATE_DIR: resolveStateDir(env),
    ...(isGatewayExternallySupervised(env) ? { BRANCH_SUPERVISOR_MODE: "external" } : {}),
  };
}

/** Bind the locator and its storage namespace before reads or caller callbacks. */
export function captureSessionTranscriptTargetBinding(
  source: SessionTranscriptRuntimeTarget & { env?: NodeJS.ProcessEnv },
) {
  return {
    ...source,
    storePath: path.resolve(source.storePath),
    env: captureSessionTranscriptStorageEnvironment(source.env ?? process.env),
  };
}

export function sameSessionTranscriptStorageEnvironment(
  left: Readonly<NodeJS.ProcessEnv> | undefined,
  right: Readonly<NodeJS.ProcessEnv> | undefined,
): boolean {
  return (
    left?.BRANCH_STATE_DIR === right?.BRANCH_STATE_DIR &&
    left?.BRANCH_SUPERVISOR_MODE === right?.BRANCH_SUPERVISOR_MODE
  );
}

export function sameSessionTranscriptTargetBinding(
  left: SessionTranscriptTargetBinding | undefined,
  right: SessionTranscriptTargetBinding | undefined,
): boolean {
  return left && right
    ? left.agentId === right.agentId &&
        left.sessionId === right.sessionId &&
        left.sessionKey === right.sessionKey &&
        left.storePath === right.storePath &&
        sameSessionTranscriptStorageEnvironment(left.env, right.env)
    : left === right;
}
