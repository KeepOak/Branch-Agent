import { formatCliCommand } from "../cli/command-format.js";
import type { PreManagedServiceStop } from "../cli/update-cli/update-command-service-maintenance.js";
import { ConfigWritePostCommitError } from "../config/io.write-errors.js";
import type { BranchConfig } from "../config/types.branch.js";
import { hasGatewayServiceStopUnsafeError } from "../daemon/service-inspection-error.js";
import { collectNestedErrorCandidates } from "../infra/error-graph-internal.js";
import { ExecApprovalsMigrationRequiredError } from "../infra/exec-approvals-migration-gate.js";
import { GatewayLockError } from "../infra/gateway-lock.js";
import type { GatewayOwnerLeaseIdentity } from "../infra/gateway-owner-lease.types.js";
import { GatewayStateOwnerContentionError } from "../infra/gateway-state-owner.js";
import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import { readStateLeaseProcessOwnerStatus } from "../infra/state-lease-process-owner.js";
import { DoctorStateMigrationRefusalError } from "../infra/state-migrations.messages.js";
import { DoctorUnreadableStateDatabaseError } from "../infra/state-repair-message.js";
import {
  DoctorMaintenanceRefusalError,
  type DoctorMaintenanceRefusal,
} from "../infra/update-doctor-result.js";
import { hasCommandProcessCleanupError } from "../process/exec-result.js";
import type { BranchDatabaseMaintenanceScope } from "../state/branch-state-db-async-lifecycle.js";
import {
  executeExistingBranchStateRead,
  withArtifactPreservingStateReads,
} from "../state/branch-state-db-readonly.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { UpdateSchemaRefusalError } from "../state/branch-update-schema-refusal.js";

/** Observe the selected installation without bootstrapping it or inheriting a discovery view. */
export async function readDoctorGatewayOwnerLease(
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<GatewayOwnerLeaseIdentity | undefined> {
  const options = { env: { ...env }, path: resolveBranchStateSqlitePath(env) };
  const reply = await withArtifactPreservingStateReads(() =>
    executeExistingBranchStateRead(
      options,
      { type: "doctor.gatewayOwnerLease.read" },
      { current: true, signal },
    ),
  );
  signal.throwIfAborted();
  if (!reply) {
    return undefined;
  }
  if (!reply.ok || reply.type !== "doctor.gatewayOwnerLease.read") {
    throw new Error("Unexpected Doctor Gateway owner lease read result");
  }
  // The recorded process may have exited while the reader and its private snapshot settled.
  return reply.lease
    ? { ...reply.lease, state: readStateLeaseProcessOwnerStatus(reply.lease) }
    : undefined;
}

/** Admission has not opened repair writers; deferral cannot authorize any later work. */
export function classifyDoctorMaintenanceRefusal(error: unknown): DoctorMaintenanceRefusal {
  const causes = collectNestedErrorCandidates(error);
  const refusal = causes.find(
    (cause): cause is DoctorMaintenanceRefusalError =>
      cause instanceof DoctorMaintenanceRefusalError && cause.refusal.kind === "data-at-risk",
  );
  if (refusal) {
    return refusal.refusal;
  }
  if (hasGatewayServiceStopUnsafeError(error) || hasCommandProcessCleanupError(error)) {
    return { kind: "data-at-risk", reason: "active-mutation" };
  }
  if (causes.some((cause) => cause instanceof DoctorUnreadableStateDatabaseError)) {
    return { kind: "data-at-risk", reason: "unreadable-state" };
  }
  if (
    causes.some(
      (cause) =>
        cause instanceof DoctorStateMigrationRefusalError ||
        cause instanceof StartupMaintenanceRequiredError ||
        cause instanceof ExecApprovalsMigrationRequiredError ||
        cause instanceof UpdateSchemaRefusalError,
    )
  ) {
    return { kind: "data-at-risk", reason: "incomplete-migration" };
  }
  if (
    causes.some(
      (cause) =>
        cause instanceof GatewayLockError ||
        (cause instanceof ConfigWritePostCommitError && cause.rollbackStatus !== "restored"),
    )
  ) {
    return { kind: "data-at-risk", reason: "gateway-state-unverified" };
  }
  return {
    kind: "deferred",
    reason: causes.some((cause) => cause instanceof GatewayStateOwnerContentionError)
      ? "coordinator-contention"
      : "admission-unavailable",
  };
}

/** The same persisted-state admission protects completion and exceptional restoration. */
export async function assertDoctorMaintenanceReady(
  cfg: BranchConfig,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<{ schemaPublicationDeferred: boolean }> {
  let schemaPublicationDeferred = false;
  const { assertSessionStoreMigrationComplete } =
    await import("../config/sessions/startup-migration.js");
  assertSessionStoreMigrationComplete({ cfg, env, operation: "doctor" });
  const { assertBranchDatabasesReady } = await import("../state/branch-database-preflight.js");
  const { resolveConfiguredAgentDatabaseTargets } = await import("../config/sessions/targets.js");
  await assertBranchDatabasesReady({
    env,
    config: cfg,
    operation: "doctor",
    onDeferredSchemaPublication: (publication) => {
      schemaPublicationDeferred = true;
      log(publication.message);
    },
    configuredAgentDatabaseTargets: resolveConfiguredAgentDatabaseTargets(cfg, { env }),
  });
  const { assertConfiguredWorkspaceStateReady } = await import("../agents/workspace-state-dirs.js");
  await assertConfiguredWorkspaceStateReady({ cfg, operation: "doctor" });
  const { assertNoPendingLegacyExecApprovals } =
    await import("../infra/exec-approvals-migration-gate.js");
  assertNoPendingLegacyExecApprovals({ operation: "doctor", env });
  return { schemaPublicationDeferred };
}

/** Repair may have committed config before a later diagnostic failed. */
export async function readDoctorMaintenanceRecoveryConfig(
  resources: Pick<BranchDatabaseMaintenanceScope, "run">,
  env: NodeJS.ProcessEnv,
  log: (message: string) => void,
): Promise<BranchConfig> {
  const { readConfigFileSnapshot } = await import("../config/config.js");
  return resources.run(async () => {
    const { config } = await readConfigFileSnapshot({
      skipPluginValidation: true,
      observe: false,
    });
    await assertDoctorMaintenanceReady(config, env, log);
    return config;
  });
}

export function assertDoctorMaintenanceInspection(
  inspection: PreManagedServiceStop,
  env: NodeJS.ProcessEnv,
): void {
  const kind = inspection.serviceUpdateVerdict?.kind;
  // Unavailable inspection grants no service authority. Process ownership and
  // agent leases still exclude live writers before repair.
  if (
    !inspection.blockMessage &&
    (kind === "unavailable" ||
      (inspection.inspected &&
        (kind === "owned" || kind === "absent" || inspection.offline === true)))
  ) {
    return;
  }
  const detail =
    inspection.blockMessage ??
    inspection.serviceMutationSkipMessage ??
    `Gateway service ownership or shutdown could not be verified. Run ${formatCliCommand("branch gateway status --deep", env)} and stop it through its service owner before retrying.`;
  const guidance =
    kind === "foreign"
      ? `Run ${formatCliCommand("branch gateway status --deep", env)} to locate the Gateway's installation, then run ${formatCliCommand("branch doctor --fix", env)} from that installation. The service was left unchanged.`
      : `Stop the Gateway service and other Branch Agent processes using this state, then run ${formatCliCommand("branch doctor --fix", env)} from an independent shell.`;
  throw new DoctorMaintenanceRefusalError(
    `Doctor could not enter maintenance. Error: ${detail} ${guidance}`,
    { kind: "data-at-risk", reason: "gateway-state-unverified" },
  );
}
