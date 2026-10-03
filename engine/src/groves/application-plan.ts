import { inspectModelReference } from "../commands/models/model-reference-validation.js";
import type { BranchConfig } from "../config/types.branch.js";
import { digestGroveValue } from "./digest.js";
import type {
  GroveAddCapabilityChange,
  GroveAddPlanAction,
  ClawDiagnostic,
  GroveExtensionPlan,
  GroveLocalPrerequisite,
  GroveBranchExtension,
  GroveBranchProfile,
  ClawPackage,
  ClawPackagePreflight,
  ClawPackagePreflightResult,
} from "./types.js";

export function groveAddCapabilityChange(
  change: Omit<GroveAddCapabilityChange, "classification" | "requiresDistinctConsent" | "digest">,
): GroveAddCapabilityChange {
  return {
    ...change,
    classification: "escalation",
    requiresDistinctConsent: true,
    digest: digestGroveValue(change.effect),
  };
}

export function groveAgentCapabilityChange(
  agentId: string,
  settings: GroveBranchProfile["agent"],
): GroveAddCapabilityChange | undefined {
  const effect = {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.subagents ? { subagents: settings.subagents } : {}),
    ...(settings.sandbox ? { sandbox: settings.sandbox } : {}),
    ...(settings.tools ? { tools: settings.tools } : {}),
    ...(settings.memory ? { memory: settings.memory } : {}),
    ...(settings.heartbeat ? { heartbeat: settings.heartbeat } : {}),
  };
  if (Object.keys(effect).length === 0) {
    return undefined;
  }
  return groveAddCapabilityChange({
    kind: "agent",
    id: agentId,
    path: "agent",
    action: "create",
    reason:
      settings.model || settings.subagents
        ? "The new agent declares model, delegation, sandbox, tool, memory-search, or recurring heartbeat configuration."
        : "The new agent declares sandbox, tool, memory-search, or recurring heartbeat capabilities.",
    effect,
  });
}

export function groveAgentConfigurationNotices(
  agent: GroveBranchProfile["agent"],
  config: BranchConfig,
  agentIds: ReadonlySet<string>,
): ClawDiagnostic[] {
  const notices: ClawDiagnostic[] = [];
  const notice = (code: string, path: string, message: string) => {
    notices.push({
      level: "warning",
      phase: "plan",
      code,
      path: `$.profiles.branch.agent.${path}`,
      message,
    });
  };
  for (const [index, target] of (agent.subagents?.allowAgents ?? []).entries()) {
    if (!agentIds.has(target)) {
      notice(
        "delegation_target_unresolved",
        `subagents.allowAgents[${index}]`,
        `Delegation target ${JSON.stringify(target)} is not in the local agent roster; it will be applied as declared. Install that agent before delegating to it.`,
      );
    }
  }
  const refs = agent.model ? [agent.model.primary, ...(agent.model.fallbacks ?? [])] : [];
  for (const [index, ref] of refs.entries()) {
    const slash = ref.indexOf("/");
    const inspection = inspectModelReference({
      cfg: config,
      ref: { provider: ref.slice(0, slash), model: ref.slice(slash + 1) },
    });
    if (inspection.status !== "known") {
      notice(
        "model_not_in_catalog",
        index === 0 ? "model.primary" : `model.fallbacks[${index - 1}]`,
        `Model ${JSON.stringify(ref)} is not in the local model catalog; it will be applied as declared. Configure it before running the agent.`,
      );
    }
  }
  return notices;
}

function blocker(code: string, path: string, message: string): ClawDiagnostic {
  return { level: "error", code, phase: "plan", path, message };
}

export function findGroveExtensionPackageCollisions(params: {
  packages: ClawPackage[];
  extensions: GroveBranchExtension[];
}): Array<{ index: number; diagnostic: ClawDiagnostic }> {
  const declaredPackageIds = new Set(params.packages.map((pkg) => `${pkg.kind}:${pkg.ref}`));
  const collisions: Array<{ index: number; diagnostic: ClawDiagnostic }> = [];

  for (const [index, extension] of params.extensions.entries()) {
    const packageId = `plugin:${extension.ref}`;
    if (declaredPackageIds.has(packageId)) {
      collisions.push({
        index,
        diagnostic: blocker(
          "extension_package_collision",
          `$.profiles.branch.extensions[${index}]`,
          `Extension package ${JSON.stringify(packageId)} is already declared by the portable manifest or another profile extension.`,
        ),
      });
      continue;
    }
    declaredPackageIds.add(packageId);
  }

  return collisions;
}

function extensionCapabilityChange(params: {
  extension: GroveBranchExtension;
  preflight: ClawPackagePreflightResult;
}): GroveAddCapabilityChange {
  const effect = {
    id: params.extension.id,
    source: params.extension.source,
    ref: params.extension.ref,
    version: params.extension.version,
    expectedFormat: params.extension.format,
    detectedFormat: params.preflight.detectedFormat ?? "unresolved",
    integrity: params.preflight.integrity ?? "unresolved",
    mapped: params.preflight.mapped ?? [],
    unavailable: params.preflight.unavailable ?? [],
    adapterIdentity: params.preflight.adapterIdentity ?? "unresolved",
    ...(params.preflight.installId ? { installId: params.preflight.installId } : {}),
    ...(params.preflight.warning ? { riskWarning: params.preflight.warning } : {}),
  };
  const change = {
    kind: "package" as const,
    id: `extension:${params.extension.id}`,
    path: `branch.extensions.${params.extension.id}`,
    action: params.preflight.action === "reuse" ? ("reuse" as const) : ("install" as const),
    reason:
      params.preflight.action === "reuse"
        ? "The Branch Agent profile requires access to an existing native extension."
        : "The Branch Agent profile requires installation of native extension content or executable code.",
    effect,
  };
  return groveAddCapabilityChange(change);
}

export async function planGroveExtensions(params: {
  extensions: GroveBranchExtension[];
  workspace: string;
  packagePreflight?: ClawPackagePreflight;
}): Promise<{
  extensions: GroveExtensionPlan[];
  actions: GroveAddPlanAction[];
  capabilityChanges: GroveAddCapabilityChange[];
  requirements: GroveLocalPrerequisite[];
  blockers: ClawDiagnostic[];
}> {
  const extensions: GroveExtensionPlan[] = [];
  const actions: GroveAddPlanAction[] = [];
  const capabilityChanges: GroveAddCapabilityChange[] = [];
  const requirements: GroveLocalPrerequisite[] = [];
  const blockers: ClawDiagnostic[] = [];

  for (const [index, extension] of params.extensions.entries()) {
    const preflight: ClawPackagePreflightResult = params.packagePreflight
      ? await params.packagePreflight(
          {
            kind: "plugin",
            source: extension.source,
            ref: extension.ref,
            version: extension.version,
          },
          params.workspace,
        )
      : {
          ok: false as const,
          code: "package_install_unavailable",
          message: "Extension preflight is unavailable.",
        };
    const completeProvenance =
      preflight.ok &&
      Boolean(
        preflight.integrity &&
        preflight.installId &&
        preflight.action &&
        preflight.detectedFormat &&
        preflight.adapterIdentity,
      );
    const incompleteProvenance =
      preflight.ok && !completeProvenance
        ? blocker(
            "extension_provenance_incomplete",
            `$.profiles.branch.extensions[${index}]`,
            `Extension ${JSON.stringify(extension.id)} did not resolve complete canonical identity and adapter provenance.`,
          )
        : undefined;
    const formatMismatch =
      preflight.ok && completeProvenance && preflight.detectedFormat !== extension.format
        ? blocker(
            "extension_format_mismatch",
            `$.profiles.branch.extensions[${index}].format`,
            `Extension ${JSON.stringify(extension.id)} declares format ${JSON.stringify(extension.format)}, but the canonical plugin detector found ${JSON.stringify(preflight.detectedFormat ?? "unknown")}.`,
          )
        : undefined;
    const diagnostic = !preflight.ok
      ? blocker(
          preflight.code ?? "extension_preflight_failed",
          `$.profiles.branch.extensions[${index}]`,
          preflight.message ?? "Extension preflight failed.",
        )
      : (incompleteProvenance ?? formatMismatch);
    if (diagnostic) {
      blockers.push(diagnostic);
    }
    if (preflight.ok && preflight.requirements) {
      requirements.push(...preflight.requirements);
    }
    const requirementState: GroveExtensionPlan["requirementState"] = diagnostic
      ? "conflicting"
      : preflight.action === "install"
        ? "missing-installable"
        : preflight.requirements && preflight.requirements.length > 0
          ? "setup-required"
          : "satisfied";
    const extensionPlan: GroveExtensionPlan = {
      ...extension,
      ...(preflight.detectedFormat ? { detectedFormat: preflight.detectedFormat } : {}),
      ...(preflight.integrity ? { integrity: preflight.integrity } : {}),
      ...(preflight.installId ? { installId: preflight.installId } : {}),
      ...(preflight.action ? { ownerAction: preflight.action } : {}),
      requirementState,
      mapped: preflight.mapped ?? [],
      unavailable: preflight.unavailable ?? [],
      ...(preflight.adapterIdentity ? { adapterIdentity: preflight.adapterIdentity } : {}),
      blocked: Boolean(diagnostic),
    };
    extensions.push(extensionPlan);
    actions.push({
      kind: "package",
      id: `plugin:${extension.ref}`,
      action: preflight.ok && preflight.action === "reuse" ? "reuse" : "install",
      target: `${extension.source}:${extension.ref}@${extension.version}`,
      ...(preflight.integrity ? { digest: preflight.integrity } : {}),
      details: {
        kind: "plugin",
        source: extension.source,
        ref: extension.ref,
        version: extension.version,
        ...(preflight.integrity ? { integrity: preflight.integrity } : {}),
        ...(preflight.installId ? { installId: preflight.installId } : {}),
        ...(preflight.action ? { ownerAction: preflight.action } : {}),
        requirementState,
        ...(preflight.requirements ? { prerequisites: preflight.requirements } : {}),
        ...(completeProvenance
          ? {
              extension: {
                id: extension.id,
                format: extension.format,
                detectedFormat: preflight.detectedFormat!,
                mapped: preflight.mapped ?? [],
                unavailable: preflight.unavailable ?? [],
                adapterIdentity: preflight.adapterIdentity!,
              },
            }
          : {}),
        expectedState: !preflight.ok
          ? "unresolved"
          : preflight.action === "reuse"
            ? "present-exact"
            : "absent",
        ...(preflight.warning ? { riskWarning: preflight.warning } : {}),
      },
      blocked: extensionPlan.blocked,
      ...(diagnostic ? { reason: diagnostic.message } : {}),
    });
    capabilityChanges.push(extensionCapabilityChange({ extension, preflight }));
  }

  return { extensions, actions, capabilityChanges, requirements, blockers };
}
