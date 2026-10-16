import { isStartupConfigRefusal } from "../../commands/doctor-startup-migration-refusal.js";
import { isInvalidConfigError } from "../../config/io.invalid-config.js";
import { isGatewayEffectiveConfigConflictError } from "../../gateway/server-runtime-config.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { findStartupMaintenanceRequiredError } from "../../infra/startup-maintenance-required.js";
import { isTailscaleRouteOwnershipConflictError } from "../../infra/tailscale-route-ownership-error.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { defaultRuntime } from "../../runtime.js";
import { BranchDatabaseSchemaPreflightError } from "../../state/branch-database-preflight.messages.js";
import { formatCliCommand } from "../command-format.js";

const gatewayLog = createSubsystemLogger("gateway");

export function resolveGatewayStartupFailureExitCode(err: unknown): number {
  return isInvalidConfigError(err) ||
    isTailscaleRouteOwnershipConflictError(err) ||
    isGatewayEffectiveConfigConflictError(err) ||
    isStartupConfigRefusal(err)
    ? 78
    : 1;
}

export function resolveGatewayStartupMaintenanceReason(error: unknown) {
  return findStartupMaintenanceRequiredError(error)?.reason;
}

export async function handleGatewayStartupMaintenance(error: unknown): Promise<boolean> {
  const maintenance = findStartupMaintenanceRequiredError(error);
  if (!maintenance) {
    return false;
  }
  const reason = maintenance.reason;
  let refusal = maintenance;
  if (
    maintenance.kind === "newer-schema" &&
    !(maintenance instanceof BranchDatabaseSchemaPreflightError)
  ) {
    // Config reads can refuse shared state before bootstrap reaches schema preflight.
    try {
      const { preflightBranchDatabaseSchemas } =
        await import("../../state/branch-database-preflight.js");
      const schemas = await preflightBranchDatabaseSchemas({ env: process.env });
      if (schemas.incompatible.length > 0) {
        refusal = new BranchDatabaseSchemaPreflightError(schemas.incompatible);
      }
    } catch {
      // Diagnostic inspection must not prevent parking and exit for the original refusal.
    }
  }
  const stop = `Stop the service with ${formatCliCommand("branch gateway stop")} (or its service owner), then`;
  const guidance =
    reason === "a newer Branch Agent build"
      ? `${stop} restore your pre-update backup created with ${formatCliCommand("branch backup create")}, then start it again with ${formatCliCommand("branch gateway start")}. See https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/install/updating#rollback.`
      : `${stop} run ${formatCliCommand("branch doctor --fix")}, then start it again with ${formatCliCommand("branch gateway start")}.`;
  let parked = false;
  try {
    // launchd ignores exit 78 under KeepAlive. Park without opening the database,
    // which may also be unavailable to the persisted crash-loop counter.
    const { parkCurrentLaunchAgentForMaintenance } = await import("../../daemon/launchd.js");
    parked = await parkCurrentLaunchAgentForMaintenance();
  } catch (parkError) {
    gatewayLog.error(`failed to park the managed LaunchAgent: ${formatErrorMessage(parkError)}`);
  }
  if (refusal instanceof BranchDatabaseSchemaPreflightError) {
    gatewayLog.error(
      `${formatErrorMessage(refusal)}${parked ? " Parked the managed LaunchAgent." : ""}`,
    );
    defaultRuntime.error(`Gateway failed to start: ${formatErrorMessage(refusal)}`);
  } else {
    gatewayLog.error(
      `gateway requires ${reason}${parked ? "; parked the managed LaunchAgent" : ""}. ${guidance}`,
    );
    defaultRuntime.error(`Gateway failed to start: ${formatErrorMessage(error)}. ${guidance}`);
  }
  // systemd's RestartPreventExitStatus already treats EX_CONFIG as terminal.
  defaultRuntime.exit(78);
  return true;
}
