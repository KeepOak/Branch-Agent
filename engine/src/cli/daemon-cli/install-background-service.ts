// Explicit "Install background service" action. Start and restart never call this;
// only the user-facing action runs the existing `branch gateway install` path.
import { resolveGatewayServiceMutationError } from "../../infra/gateway-supervision.js";
import { formatCliCommand } from "../command-format.js";
import type { DaemonInstallOptions } from "./types.js";

export const INSTALL_BACKGROUND_SERVICE_ID = "install-background-service";
export const INSTALL_BACKGROUND_SERVICE_LABEL = "Install background service";
export const INSTALL_BACKGROUND_SERVICE_COMMAND = "branch gateway install-background-service";

export type InstallBackgroundServiceAction = {
  id: typeof INSTALL_BACKGROUND_SERVICE_ID;
  label: typeof INSTALL_BACKGROUND_SERVICE_LABEL;
  command: string;
};

export function resolveInstallBackgroundServiceAction(
  env: NodeJS.ProcessEnv = process.env,
): InstallBackgroundServiceAction | null {
  if (resolveGatewayServiceMutationError("install the gateway service", env)) {
    return null;
  }
  return {
    id: INSTALL_BACKGROUND_SERVICE_ID,
    label: INSTALL_BACKGROUND_SERVICE_LABEL,
    command: formatCliCommand(INSTALL_BACKGROUND_SERVICE_COMMAND, env),
  };
}

export function shouldOfferInstallBackgroundServiceAction(status: {
  service?: {
    runtime?: { missingUnit?: boolean };
    loadState?: { status?: string };
  };
}): boolean {
  return (
    status.service?.runtime?.missingUnit === true ||
    status.service?.loadState?.status === "not-loaded"
  );
}

export function attachInstallBackgroundServiceAction<
  T extends {
    service?: {
      runtime?: { missingUnit?: boolean };
      loadState?: { status?: string };
    };
  },
>(
  status: T,
  env: NodeJS.ProcessEnv = process.env,
): T & { actions?: InstallBackgroundServiceAction[] } {
  if (!shouldOfferInstallBackgroundServiceAction(status)) {
    return status;
  }
  const action = resolveInstallBackgroundServiceAction(env);
  if (!action) {
    return status;
  }
  return { ...status, actions: [action] };
}

/** User-clicked action: the same path as `branch gateway install`. */
export async function runInstallBackgroundService(opts?: DaemonInstallOptions): Promise<void> {
  const mutationError = resolveGatewayServiceMutationError("install the gateway service");
  if (mutationError) {
    throw mutationError;
  }
  const { runDaemonInstall } = await import("./install.runtime.js");
  await runDaemonInstall(opts ?? {});
}
