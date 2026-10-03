import type { GroveAddPlan, ClawDiagnostic } from "../groves/types.js";
import type { GroveUpdatePlan } from "../groves/update-plan.js";
import { redactSensitiveText } from "../logging/redact.js";
import { writeRuntimeJson, type RuntimeEnv } from "../runtime.js";

export function emitGroveFailure(
  runtime: RuntimeEnv,
  json: boolean | undefined,
  message: string,
  payload: unknown,
): void {
  if (json) {
    writeRuntimeJson(runtime, payload);
  } else {
    runtime.error(message);
  }
  runtime.exit(1);
}

export function formatClawDiagnostics(diagnostics: readonly ClawDiagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.level.toUpperCase()} ${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`,
    )
    .join("\n");
}

export function logGroveExperimentalWarning(runtime: RuntimeEnv): void {
  runtime.log("Experimental: Groves contracts may change while RFC 0016 is under review.");
}

function logGrovePlanNotices(diagnostics: ClawDiagnostic[], runtime: RuntimeEnv): void {
  for (const diagnostic of diagnostics.filter((entry) => entry.level === "warning")) {
    runtime.log(redactSensitiveText(`Notice: ${diagnostic.message}`));
  }
}

export function logGroveAgentConfiguration(plan: GroveAddPlan, runtime: RuntimeEnv): void {
  const { model, subagents } = plan.agent.config;
  if (model !== undefined) {
    runtime.log(`Model: ${JSON.stringify(model)}`);
  }
  if (subagents) {
    const targets =
      subagents.allowAgents?.join(", ") || (subagents.allowAgents ? "none" : "inherited");
    runtime.log(`Delegation: ${targets}; mode: ${subagents.delegationMode ?? "inherited"}`);
  }
  logGrovePlanNotices(plan.diagnostics, runtime);
}

export function logGroveUpdatePlanSummary(plan: GroveUpdatePlan, runtime: RuntimeEnv): void {
  runtime.log(`Agent: ${plan.agentId}`);
  runtime.log(`Update actions: ${plan.summary.totalActions}`);
  runtime.log(
    `Add: ${plan.summary.added}; change: ${plan.summary.changed}; remove: ${plan.summary.removed}; release: ${plan.summary.released}; unchanged: ${plan.summary.unchanged}; manual: ${plan.summary.manual}`,
  );
  runtime.log(
    `Capability changes: ${plan.summary.capabilityChanges}; escalations requiring explicit review: ${plan.summary.capabilityEscalations}`,
  );
  runtime.log(`Plan integrity: ${plan.planIntegrity}`);
  logGrovePlanNotices(plan.diagnostics, runtime);
  if (plan.summary.capabilityEscalations > 0) {
    runtime.log(
      "Capability consent: the exact plan-integrity token binds every ! change disclosed below.",
    );
  }
  for (const change of plan.capabilityChanges) {
    const current = change.current?.summary ?? "unset";
    const desired = change.desired?.summary ?? "unset";
    runtime.log(
      `  ${change.requiresDistinctConsent ? "!" : "-"} ${change.path}: ${current} -> ${desired} (${change.action})`,
    );
    runtime.log(redactSensitiveText(`      effect: ${JSON.stringify(change.effect)}`));
  }
  if (plan.readiness.requirements.length > 0) {
    runtime.log(`Setup requirements (${plan.readiness.requirements.length}):`);
    for (const requirement of plan.readiness.requirements) {
      runtime.log(redactSensitiveText(`  - ${JSON.stringify(requirement)}`));
    }
  }
  if (plan.blockers.length > 0) {
    runtime.error(formatClawDiagnostics(plan.blockers));
  }
}
