// When start or restart finds no gateway service, install the same way
// `branch gateway install` does, then the caller waits for readiness.
import { resolveGatewayServiceMutationError } from "../../infra/gateway-supervision.js";
import { appendGatewayLifecycleAudit } from "./lifecycle-audit.js";
import type { DaemonLifecycleOptions } from "./types.js";

export const MISSING_GATEWAY_SERVICE_INSTALLED_MESSAGE =
  "Gateway service was missing; installed and started it.";

export type MissingGatewayServiceInstallResult<TResult extends "started" | "restarted"> = {
  result: TResult;
  loaded: true;
  message: string;
};

/** Installs the missing managed Gateway service using `runDaemonInstall`. */
export async function installMissingGatewayService<TResult extends "started" | "restarted">(params: {
  result: TResult;
  opts?: DaemonLifecycleOptions;
}): Promise<MissingGatewayServiceInstallResult<TResult> | null> {
  const mutationError = resolveGatewayServiceMutationError("install the gateway service");
  if (mutationError) {
    return null;
  }
  const { runDaemonInstall } = await import("./install.runtime.js");
  await runDaemonInstall({ json: Boolean(params.opts?.json) });
  appendGatewayLifecycleAudit({
    action: params.result === "started" ? "start" : "restart",
    source: "cli",
    mode: "bootstrap",
  });
  return {
    result: params.result,
    loaded: true,
    message: MISSING_GATEWAY_SERVICE_INSTALLED_MESSAGE,
  };
}
