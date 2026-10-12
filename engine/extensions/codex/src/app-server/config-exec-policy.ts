import { AgentHarnessPreflightError } from "branch/plugin-sdk/agent-harness-registration";
import type {
  CodexAppServerApprovalPolicy,
  CodexAppServerDefaultPolicy,
  CodexAppServerPolicyMode,
  BranchExecMode,
  BranchExecPolicyForCodexAppServer,
} from "./config-contracts.js";
import type { CodexApprovalsReviewer, CodexSandboxMode } from "./protocol.js";

export function selectForcedPromptingSandbox(params: {
  configuredSandbox?: CodexSandboxMode;
  defaultSandbox?: CodexSandboxMode;
}): CodexSandboxMode {
  if (params.configuredSandbox === "read-only" || params.defaultSandbox === "read-only") {
    return "read-only";
  }
  return params.defaultSandbox ?? "workspace-write";
}

export function selectForcedDangerFullAccessSandbox(params: {
  configuredSandbox?: CodexSandboxMode;
  defaultPolicy: CodexAppServerDefaultPolicy | undefined;
  branchSandboxActive: boolean;
}): CodexSandboxMode {
  if (params.configuredSandbox === "read-only") {
    return "read-only";
  }
  if (params.defaultPolicy?.dangerFullAccessAllowed === false) {
    if (params.branchSandboxActive) {
      return params.defaultPolicy.sandbox ?? "workspace-write";
    }
    throw new Error(
      "legacy full exec security with ask requires Codex app-server danger-full-access",
    );
  }
  return "danger-full-access";
}

export function selectGuardianSandbox(
  allowedSandboxModes: Set<CodexSandboxMode> | undefined,
): CodexSandboxMode {
  if (allowedSandboxModes === undefined || allowedSandboxModes.has("workspace-write")) {
    return "workspace-write";
  }
  if (allowedSandboxModes.has("read-only")) {
    return "read-only";
  }
  if (allowedSandboxModes.has("danger-full-access")) {
    return "danger-full-access";
  }
  return "workspace-write";
}

export function resolveApprovalPolicy(value: unknown): CodexAppServerApprovalPolicy | undefined {
  if (value === "untrusted") {
    throw new Error(
      'Codex app-server approval policy "untrusted" is retired; run "branch doctor --fix" and use "on-request".',
    );
  }
  if (value === "on-failure") {
    return "on-request";
  }
  return value === "on-request" || value === "never" ? value : undefined;
}

export function resolveSandbox(value: unknown): CodexSandboxMode | undefined {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : undefined;
}

export function resolveApprovalsReviewer(value: unknown): CodexApprovalsReviewer | undefined {
  return value === "auto_review" || value === "guardian_subagent" || value === "user"
    ? value
    : undefined;
}

export function resolveEffectiveBranchExecModeForCodexAppServer(params: {
  execMode?: BranchExecMode;
  execPolicy?: BranchExecPolicyForCodexAppServer;
}): BranchExecMode | undefined {
  if (params.execPolicy?.touched === true) {
    return params.execPolicy.mode;
  }
  return params.execMode;
}

export function resolveCodexPolicyModeForBranchExecMode(
  mode: BranchExecMode | undefined,
): CodexAppServerPolicyMode | undefined {
  if (!mode || mode === "full") {
    return undefined;
  }
  return "guardian";
}

export function assertCodexAppServerAllowedForBranchExecMode(
  mode: BranchExecMode | undefined,
): void {
  if (mode === "deny" || mode === "allowlist") {
    throw new AgentHarnessPreflightError(
      `Codex app-server local execution is unavailable because effective tools.exec.mode=${mode}. ` +
        "Execution-host approvals are authoritative. For gateway turns, inspect them with `branch approvals get --gateway` and update that same target with `branch approvals set --gateway --stdin`; for local `agent exec`, omit `--gateway`. Intentionally align that host policy before retrying.",
      { scope: "harness" },
    );
  }
}
