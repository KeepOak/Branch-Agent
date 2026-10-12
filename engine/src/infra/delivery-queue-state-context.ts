import { resolveStateDir } from "../config/state-dir.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { isGatewayExternallySupervised } from "./gateway-supervision.js";

export type DeliveryQueueStateContext = {
  stateDir: string;
  workerContext: BranchStateWorkerContext;
  supervisorMode?: "external";
};

export function captureDeliveryQueueStateContext(stateDir?: string): DeliveryQueueStateContext {
  const env = resolveDeliveryQueueStateEnv(stateDir);
  return {
    workerContext: captureBranchStateWorkerContext({ env }),
    stateDir: resolveStateDir(env),
    ...(isGatewayExternallySupervised(process.env) ? { supervisorMode: "external" as const } : {}),
  };
}

export function resolveDeliveryQueueStateEnv(
  stateDir?: string,
  context?: DeliveryQueueStateContext,
): NodeJS.ProcessEnv {
  return context
    ? {
        ...process.env,
        BRANCH_STATE_DIR: context.stateDir,
        // Captured absence must not inherit a later ambient supervisor mode.
        BRANCH_SUPERVISOR_MODE: context.supervisorMode,
      }
    : stateDir
      ? { ...process.env, BRANCH_STATE_DIR: stateDir }
      : process.env;
}
