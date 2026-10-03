import { lstat } from "node:fs/promises";
import { listAgentIds } from "../agents/agent-scope-config.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { BranchConfig } from "../config/types.branch.js";
import { root as fsSafeRoot } from "../infra/fs-safe.js";
import {
  openExistingBranchStateDatabaseReadOnly,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import {
  groveExtensionProvenanceChanged,
  clawPackageActionsById,
  clawPackageKey,
  groveTargetPackages,
  groveWorkspaceActionsById,
  isApplicationUpdateBlocker,
  recordingClawPackagePreflight,
} from "./application-provenance.js";
import { digestGroveValue as digest } from "./digest.js";
import { readGroveStatus } from "./lifecycle-state.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { digestGroveMcpServer, readGroveMcpServerRefsByName } from "./mcp.js";
import { normalizeWorkspaceConfig, resolveMigrationAgentSettings } from "./migrate-validation.js";
import type { PackageRemovalDeps } from "./package-remove.js";
import { digestClawPackageRef } from "./package-update-provenance.js";
import { readClawPackageRefs } from "./provenance.js";
import {
  GROVE_OUTPUT_STABILITY,
  type ClawDiagnostic,
  type GroveManifest,
  type GroveBranchProfile,
  type ClawPackagePreflight,
  type ClawPackagePreflightResult,
  type GroveSourceIdentity,
} from "./types.js";
import {
  packageCapabilityChange,
  pushResolvedAgentCapabilityChanges,
  resourceCapabilityChange,
  type GroveUpdateCapabilityChange,
} from "./update-capability-changes.js";
import { makeEmptyGroveUpdatePlan } from "./update-plan-empty.js";
import { summarizeGroveUpdatePlan } from "./update-plan-summary.js";
import {
  GROVE_UPDATE_PLAN_SCHEMA_VERSION,
  type GroveUpdateAction,
  type GroveUpdatePlan,
} from "./update-plan-types.js";

export {
  GROVE_UPDATE_PLAN_SCHEMA_VERSION,
  type GroveUpdateAction,
  type GroveUpdatePlan,
} from "./update-plan-types.js";

function diagnostic(code: string, path: string, message: string): ClawDiagnostic {
  return { level: "error", code, phase: "plan", path, message };
}

function manualState(state: string): boolean {
  return state === "modified" || state === "unsafe" || state === "pending" || state === "failed";
}

export async function buildGroveUpdatePlan(params: {
  agentId: string;
  targetManifest: GroveManifest;
  targetGroveMarkdownBody?: Buffer;
  targetBranchProfile?: GroveBranchProfile;
  targetSource: GroveSourceIdentity;
  config: BranchConfig;
  sourceMcpServers: Record<string, Record<string, unknown>>;
  stateOptions?: BranchStateDatabaseOptions & { packageDeps?: PackageRemovalDeps };
  packagePreflight?: ClawPackagePreflight;
  diagnostics?: ClawDiagnostic[];
}): Promise<GroveUpdatePlan> {
  const notFound = (): GroveUpdatePlan =>
    makeEmptyGroveUpdatePlan({
      agentId: params.agentId,
      source: params.targetSource,
      blockers: [
        diagnostic(
          "grove_not_found",
          "$",
          `No installed Grove agent matches ${JSON.stringify(params.agentId)}.`,
        ),
      ],
      diagnostics: params.diagnostics,
    });
  const ownsDatabase = !params.stateOptions?.database;
  const database =
    params.stateOptions?.database ??
    (await openExistingBranchStateDatabaseReadOnly(params.stateOptions));
  if (!database) {
    return notFound();
  }
  if (
    !database.db /* sqlite-allow-raw: read-only Grove install table-existence probe. */
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grove_installs'")
      .get()
  ) {
    if (ownsDatabase) {
      database.walMaintenance.close();
    }
    return notFound();
  }
  const readOnlyStateOptions: BranchStateDatabaseOptions & {
    packageDeps?: PackageRemovalDeps;
  } = {
    ...params.stateOptions,
    database,
    readOnly: true,
  };
  try {
    const status = await readGroveStatus(params.agentId, {
      ...readOnlyStateOptions,
      config: params.config,
      sourceMcpServers: params.sourceMcpServers,
      ...(params.packagePreflight ? { packagePreflight: params.packagePreflight } : {}),
    });
    if (status.records.length === 0) {
      return notFound();
    }
    if (status.records.length > 1) {
      return makeEmptyGroveUpdatePlan({
        agentId: params.agentId,
        source: params.targetSource,
        found: true,
        blockers: [
          diagnostic(
            "grove_ambiguous",
            "$",
            `Grove name ${JSON.stringify(params.agentId)} matches multiple agents; use an agent id.`,
          ),
        ],
        diagnostics: params.diagnostics,
      });
    }
    const record = status.records[0]!;
    const agentId = record.install.agentId;
    if (record.install.grove.name !== params.targetSource.name) {
      return makeEmptyGroveUpdatePlan({
        agentId,
        source: params.targetSource,
        found: true,
        currentGrove: {
          name: record.install.grove.name,
          version: record.install.grove.version,
          integrity: record.install.grove.integrity,
        },
        blockers: [
          diagnostic(
            "grove_identity_mismatch",
            "$.name",
            `Target package ${JSON.stringify(params.targetSource.name)} does not match installed Grove ${JSON.stringify(record.install.grove.name)}.`,
          ),
        ],
        diagnostics: params.diagnostics,
      });
    }

    const packagePreflights = new Map<string, ClawPackagePreflightResult>();
    const currentPackages = new Map(
      record.packages.map((pkg) => [clawPackageKey(pkg), pkg] as const),
    );
    const targetPlan = await buildGroveAddPlan({
      manifest: params.targetManifest,
      groveMarkdownBody: params.targetGroveMarkdownBody,
      includePackageBootstrap: false,
      branchProfile: params.targetBranchProfile,
      source: params.targetSource,
      diagnostics: params.diagnostics,
      context: {
        config: params.config,
        existingAgentIds: listAgentIds(params.config).filter((id) => id !== agentId),
        agentId,
        workspace: record.install.workspace,
        packagePreflight: recordingClawPackagePreflight(
          params.packagePreflight,
          record.install.workspace,
          packagePreflights,
          currentPackages,
        ),
      },
    });
    const blockers = targetPlan.blockers.filter(isApplicationUpdateBlocker);
    const actions: GroveUpdateAction[] = [];
    const capabilityChanges: GroveUpdateCapabilityChange[] = [];

    let desiredAgentDigest = digest(targetPlan.agent.config);
    let adoptedSettingsUnsupported = false;
    if (record.install.agentOrigin === "adopted") {
      try {
        desiredAgentDigest = digest(
          normalizeWorkspaceConfig(
            resolveMigrationAgentSettings(params.config, targetPlan.agent.config),
            record.install.workspace,
          ),
        );
      } catch {
        adoptedSettingsUnsupported = true;
      }
    }
    const agentAction =
      record.agentState === "modified" || adoptedSettingsUnsupported
        ? "manual"
        : record.agentState === "missing"
          ? "change"
          : record.install.agentConfigDigest === desiredAgentDigest
            ? "unchanged"
            : "change";
    actions.push({
      kind: "agent",
      id: agentId,
      action: agentAction,
      target: `agents.entries[${JSON.stringify(agentId)}]`,
      blocked: agentAction === "manual",
      reason:
        agentAction === "manual"
          ? adoptedSettingsUnsupported
            ? "Current inherited agent defaults cannot be represented by the installed Grove v1 package. Reconcile those settings manually."
            : "Live agent config changed after installation and must be reconciled manually."
          : record.agentState === "missing"
            ? "Owned agent config is missing and would be restored from the target manifest."
            : agentAction === "unchanged"
              ? "Owned agent config already matches the target manifest."
              : "Target manifest changes owned agent config.",
      ...(record.agentState === "missing"
        ? {}
        : { currentDigest: record.install.agentConfigDigest }),
      desiredDigest: desiredAgentDigest,
    });
    pushResolvedAgentCapabilityChanges({
      changes: capabilityChanges,
      agentId,
      config: params.config,
      desiredAgent: targetPlan.agent.config,
    });

    const targetFiles = groveWorkspaceActionsById(targetPlan.actions);
    const currentFiles = new Map(record.workspaceFiles.map((file) => [file.path, file] as const));
    let workspace: Awaited<ReturnType<typeof fsSafeRoot>> | undefined;
    let workspaceState: "present" | "missing" | "unsafe" = "present";
    try {
      const workspaceStat = await lstat(record.install.workspace);
      if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
        workspaceState = "unsafe";
      } else {
        workspace = await fsSafeRoot(record.install.workspace, {
          hardlinks: "reject",
          symlinks: "reject",
        });
      }
    } catch (error) {
      workspaceState =
        error && typeof error === "object" && "code" in error && error.code === "ENOENT"
          ? "missing"
          : "unsafe";
    }
    for (const [path, target] of targetFiles) {
      const current = currentFiles.get(path);
      if (!target.digest) {
        actions.push({
          kind: "workspaceFile",
          id: path,
          action: "manual",
          target: `${record.install.workspace}:${path}`,
          blocked: true,
          reason: target.reason ?? "Target workspace source could not be verified.",
        });
        continue;
      }
      let unownedDestination: "absent" | "occupied" | "unsafe" =
        workspaceState === "unsafe" ? "unsafe" : "absent";
      if (!current) {
        if (workspace) {
          try {
            unownedDestination = (await workspace.exists(path)) ? "occupied" : "absent";
          } catch {
            unownedDestination = "unsafe";
          }
        }
      }
      const currentFileRequiresManual =
        current !== undefined &&
        manualState(current.state) &&
        !(workspaceState === "missing" && current.state === "unsafe");
      const action =
        workspaceState === "unsafe"
          ? "manual"
          : !current && unownedDestination !== "absent"
            ? "manual"
            : !current
              ? "add"
              : currentFileRequiresManual
                ? "manual"
                : current.contentDigest === target.digest && current.state === "unchanged"
                  ? "unchanged"
                  : "change";
      actions.push({
        kind: "workspaceFile",
        id: path,
        action,
        target: `${record.install.workspace}:${path}`,
        blocked: action === "manual",
        reason:
          unownedDestination === "occupied"
            ? "Workspace path already exists without Grove ownership and must be preserved."
            : unownedDestination === "unsafe"
              ? "Workspace path is unsafe to inspect and cannot be claimed automatically."
              : workspaceState === "missing" && current
                ? "Owned workspace is missing and this file would be restored."
                : action === "add"
                  ? "Target manifest adds a managed workspace file."
                  : action === "manual"
                    ? "Local workspace content changed or became unsafe and must be reconciled manually."
                    : action === "unchanged"
                      ? "Managed workspace content already matches the target source."
                      : "Target source changes or restores managed workspace content.",
        ...(current ? { currentDigest: current.contentDigest } : {}),
        ...(current ? { currentPresent: current.state !== "missing" } : {}),
        desiredDigest: target.digest,
      });
    }
    for (const current of record.workspaceFiles) {
      if (targetFiles.has(current.path)) {
        continue;
      }
      const manual =
        workspaceState === "unsafe" ||
        (manualState(current.state) &&
          !(workspaceState === "missing" && current.state === "unsafe"));
      actions.push({
        kind: "workspaceFile",
        id: current.path,
        action: manual ? "manual" : "remove",
        target: `${current.workspace}:${current.path}`,
        blocked: manual,
        reason: manual
          ? "Target removes this file, but local drift must be preserved manually."
          : "Target manifest removes this managed workspace file.",
        currentDigest: current.contentDigest,
        currentPresent: current.state !== "missing",
      });
    }

    const allPackages = readClawPackageRefs(readOnlyStateOptions);
    const targetPackages = groveTargetPackages(params.targetManifest, params.targetBranchProfile);
    const targetPackageActions = clawPackageActionsById(targetPlan.actions);
    for (const [key, target] of targetPackages) {
      const current = currentPackages.get(key);
      const preflight = packagePreflights.get(key);
      const targetAction = targetPackageActions.get(key);
      const extensionChanged = groveExtensionProvenanceChanged(current?.extension, targetAction);
      const requiresPackageMutation =
        !current ||
        (current.origin === "grove-introduced" &&
          !current.independentOwner &&
          (current.state === "missing" || current.version !== target.version));
      const failedPackageMutationPreflight = requiresPackageMutation && !preflight?.ok;
      const conflictingPluginPin =
        target.kind === "plugin" &&
        allPackages.some(
          (candidate) =>
            candidate.agentId !== agentId &&
            candidate.kind === target.kind &&
            candidate.source === target.source &&
            candidate.ref === target.ref &&
            candidate.version !== target.version,
        );
      const unresolvedCurrent =
        current && ["modified", "ambiguous", "incomplete"].includes(current.state);
      const independentlyOwnedMutation =
        current &&
        (current.origin === "pre-existing" || current.independentOwner) &&
        (current.state === "missing" || current.version !== target.version);
      const action =
        conflictingPluginPin ||
        unresolvedCurrent ||
        independentlyOwnedMutation ||
        failedPackageMutationPreflight
          ? "manual"
          : !current
            ? "add"
            : current.state === "missing"
              ? "change"
              : current.version === target.version && !extensionChanged
                ? "unchanged"
                : "change";
      actions.push({
        kind: "package",
        id: key,
        action,
        target: `${target.source}:${target.ref}@${target.version}`,
        blocked: action === "manual",
        reason:
          action === "manual"
            ? conflictingPluginPin
              ? "Another Grove pins an incompatible version of this shared plugin."
              : independentlyOwnedMutation
                ? "Package is independently owned and cannot be restored or changed by this Grove."
                : failedPackageMutationPreflight
                  ? (preflight?.message ?? "Package preflight failed.")
                  : `Current package lifecycle state is ${current?.state ?? "unknown"} and must be reconciled manually.`
            : action === "add"
              ? "Target manifest adds a package reference."
              : action === "unchanged"
                ? "Recorded package reference already matches the exact target version and extension mapping."
                : current?.version === target.version
                  ? "Target profile changes extension provenance without reinstalling the package."
                  : "Target manifest changes the exact package version.",
        ...(current ? { currentDigest: digestClawPackageRef(current) } : {}),
        desiredDigest: digest({
          package: target,
          integrity: preflight?.integrity,
          installId: preflight?.installId,
          riskWarning: preflight?.warning,
          prerequisites: preflight?.requirements,
          extension: targetAction?.details?.extension,
        }),
      });
      const capabilityChange = packageCapabilityChange({
        pkg: target,
        action,
        currentVersion: current?.version,
        desiredVersion: target.version,
        integrity: preflight?.integrity,
        installId: preflight?.installId,
        riskWarning: preflight?.warning,
        currentExtension: current?.extension,
        desiredExtension: targetAction?.details?.extension,
      });
      if (capabilityChange) {
        capabilityChanges.push(capabilityChange);
      }
      if (failedPackageMutationPreflight) {
        const packageIndex = params.targetManifest.packages.findIndex(
          (pkg) => clawPackageKey(pkg) === key,
        );
        const extensionIndex =
          params.targetBranchProfile?.extensions?.findIndex(
            (extension) => clawPackageKey(extension) === key,
          ) ?? -1;
        const path =
          packageIndex >= 0
            ? `$.packages[${packageIndex}]`
            : `$.profiles.branch.extensions[${extensionIndex}]`;
        const code = preflight?.code ?? "package_install_unavailable";
        if (!blockers.some((entry) => entry.code === code && entry.path === path)) {
          blockers.push(diagnostic(code, path, preflight?.message ?? "Package preflight failed."));
        }
      }
    }
    for (const [key, current] of currentPackages) {
      if (!targetPackages.has(key)) {
        const manual = current.state !== "present";
        const action = manual ? "manual" : "release";
        actions.push({
          kind: "package",
          id: key,
          action,
          target: `${current.source}:${current.ref}@${current.version}`,
          blocked: manual,
          reason: manual
            ? `Target removes this package, but current lifecycle state is ${current.state}.`
            : "Target manifest releases this package dependency while preserving the artifact.",
          currentDigest: digestClawPackageRef(current),
        });
        const capabilityChange = packageCapabilityChange({
          pkg: current,
          action,
          currentVersion: current.version,
        });
        if (capabilityChange) {
          capabilityChanges.push(capabilityChange);
        }
      }
    }

    const configuredMcpServers = normalizeConfiguredMcpServers(params.sourceMcpServers);
    const currentMcp = new Map(record.mcpServers.map((server) => [server.name, server] as const));
    for (const [name, target] of Object.entries(params.targetManifest.mcpServers)) {
      const current = currentMcp.get(name);
      const desiredDigest = digestGroveMcpServer(target);
      const unownedLiveServer = !current && Object.hasOwn(configuredMcpServers, name);
      const sharedWithOtherGroves =
        current &&
        readGroveMcpServerRefsByName(name, readOnlyStateOptions).some(
          (candidate) => candidate.agentId !== agentId,
        );
      const independentlyOwnedMutation =
        current !== undefined &&
        (current.origin === "pre-existing" || current.independentOwner) &&
        (current.configDigest !== desiredDigest || current.state !== "present");
      const sharedChange = sharedWithOtherGroves && current?.configDigest !== desiredDigest;
      const action =
        unownedLiveServer || independentlyOwnedMutation || sharedChange
          ? "manual"
          : !current
            ? "add"
            : manualState(current.state)
              ? "manual"
              : current.configDigest === desiredDigest && current.state === "present"
                ? "unchanged"
                : "change";
      actions.push({
        kind: "mcpServer",
        id: name,
        action,
        target: `mcp.servers.${name}`,
        blocked: action === "manual",
        reason: unownedLiveServer
          ? "MCP server name already exists without this Grove's ownership."
          : independentlyOwnedMutation
            ? "MCP server is independently owned and cannot be restored or changed by this Grove."
            : sharedChange
              ? "Another Grove shares this MCP declaration and blocks changing global config."
              : action === "manual"
                ? "MCP ownership is unresolved or live config drifted and must be reconciled manually."
                : action === "unchanged"
                  ? "Owned MCP config digest already matches the target declaration."
                  : `Target manifest ${action === "add" ? "adds" : "changes or restores"} this MCP declaration.`,
        ...(current ? { currentDigest: current.configDigest } : {}),
        desiredDigest,
      });
      const capabilityChange = resourceCapabilityChange({
        kind: "mcpServer",
        id: name,
        action,
        current: current ? configuredMcpServers[name] : undefined,
        desired: target,
      });
      if (capabilityChange) {
        capabilityChanges.push(capabilityChange);
      }
    }
    for (const current of record.mcpServers) {
      if (Object.hasOwn(params.targetManifest.mcpServers, current.name)) {
        continue;
      }
      const manual = current.state === "pending" || current.state === "failed";
      const sharedOrIndependent =
        current.relationship === "referenced" ||
        current.origin === "pre-existing" ||
        current.independentOwner ||
        readGroveMcpServerRefsByName(current.name, readOnlyStateOptions).some(
          (candidate) => candidate.agentId !== agentId,
        );
      const ownerAction =
        current.state === "present" && !sharedOrIndependent ? "remove" : "release";
      const action = manual ? "manual" : ownerAction;
      actions.push({
        kind: "mcpServer",
        id: current.name,
        action,
        target: `mcp.servers.${current.name}`,
        blocked: manual,
        reason: manual
          ? "Target removes this MCP declaration, but ownership is incomplete."
          : ownerAction === "release"
            ? "Target manifest releases this Grove's reference while preserving shared or independently owned MCP config."
            : "Target manifest removes this solely owned MCP declaration.",
        currentDigest: current.configDigest,
      });
      const capabilityChange = resourceCapabilityChange({
        kind: "mcpServer",
        id: current.name,
        action,
        current: configuredMcpServers[current.name],
      });
      if (capabilityChange) {
        capabilityChanges.push(capabilityChange);
      }
    }

    const currentCron = new Map(record.cronJobs.map((cron) => [cron.manifestId, cron] as const));
    for (const target of params.targetManifest.cronJobs) {
      const current = currentCron.get(target.id);
      const desiredDigest = digest(target);
      const unresolved = current && (current.status !== "complete" || !current.schedulerJobId);
      const action = !current
        ? "add"
        : unresolved
          ? "manual"
          : digest(current.job) === desiredDigest
            ? "unchanged"
            : "change";
      actions.push({
        kind: "cronJob",
        id: target.id,
        action,
        target: current?.schedulerJobId ?? `grove:${agentId}:${target.id}`,
        blocked: action === "manual",
        reason:
          action === "manual"
            ? "Cron ownership is unresolved and must be reconciled with the gateway."
            : action === "unchanged"
              ? "Recorded cron declaration already matches the target manifest."
              : `Target manifest ${action === "add" ? "adds" : "changes"} this cron declaration.`,
        ...(current ? { currentDigest: digest(current.job) } : {}),
        desiredDigest,
      });
      const capabilityChange = resourceCapabilityChange({
        kind: "cronJob",
        id: target.id,
        action,
        current: current?.job,
        desired: target,
      });
      if (capabilityChange) {
        capabilityChanges.push(capabilityChange);
      }
    }
    for (const current of record.cronJobs) {
      if (params.targetManifest.cronJobs.some((cron) => cron.id === current.manifestId)) {
        continue;
      }
      const manual = current.status !== "complete" || !current.schedulerJobId;
      const action = manual ? "manual" : "remove";
      actions.push({
        kind: "cronJob",
        id: current.manifestId,
        action,
        target: current.schedulerJobId ?? current.declarationKey,
        blocked: manual,
        reason: manual
          ? "Target removes this cron declaration, but scheduler ownership is unresolved."
          : "Target manifest removes this owned cron declaration.",
        currentDigest: digest(current.job),
      });
      const capabilityChange = resourceCapabilityChange({
        kind: "cronJob",
        id: current.manifestId,
        action,
        current: current.job,
      });
      if (capabilityChange) {
        capabilityChanges.push(capabilityChange);
      }
    }

    actions.sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`),
    );
    capabilityChanges.sort((left, right) =>
      `${left.kind}:${left.id}:${left.path}`.localeCompare(
        `${right.kind}:${right.id}:${right.path}`,
      ),
    );
    const plan: Omit<GroveUpdatePlan, "planIntegrity"> = {
      schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      dryRun: true,
      mutationAllowed: false,
      found: true,
      agentId,
      currentGrove: {
        name: record.install.grove.name,
        version: record.install.grove.version,
        integrity: record.install.grove.integrity,
      },
      targetGrove: {
        name: params.targetSource.name,
        version: params.targetSource.version,
        integrity: params.targetSource.integrity,
      },
      summary: summarizeGroveUpdatePlan(actions, capabilityChanges),
      actions,
      capabilityChanges,
      readiness: targetPlan.readiness,
      blockers,
      diagnostics: targetPlan.diagnostics,
    };
    return { ...plan, planIntegrity: digest(plan) };
  } finally {
    if (ownsDatabase) {
      database.walMaintenance.close();
    }
  }
}
