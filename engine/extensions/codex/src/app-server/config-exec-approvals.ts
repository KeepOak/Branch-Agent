import {
  execPolicy,
  type EmbeddedRunAttemptParamsV2,
} from "branch/plugin-sdk/agent-harness-runtime";
import { resolveAgentConfig } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  resolveExecApprovalsFromFile,
  type ExecApprovalsFile,
} from "branch/plugin-sdk/exec-approvals-runtime";
import type {
  BranchExecApprovalFloorsForCodexAppServer,
  BranchExecMode,
  BranchExecPolicyForCodexAppServer,
} from "./config-contracts.js";
import { readExecAsk, readExecSecurity, readRecord } from "./config-utils.js";

function resolveBranchExecPolicyFromConfig(params: {
  config?: BranchConfig;
  agentId?: string;
}): BranchExecPolicyForCodexAppServer {
  const globalExec = readRecord(params.config?.tools?.exec);
  const globalPolicy = applyBranchExecPolicyLayer(
    { ...resolveBranchExecPolicyForMode("full"), touched: false },
    globalExec,
  );
  const agentId = params.agentId?.trim();
  const agentExec = agentId
    ? readRecord(resolveAgentConfig(params.config ?? {}, agentId)?.tools?.exec)
    : undefined;
  return applyBranchExecPolicyLayer(globalPolicy, agentExec);
}

export function resolveBranchExecPolicyForCodexAppServer(params: {
  permissionMode?: EmbeddedRunAttemptParamsV2["permissionMode"];
  execOverrides?: {
    mode?: unknown;
    security?: unknown;
    ask?: unknown;
  };
  approvals?: ExecApprovalsFile;
  config?: BranchConfig;
  agentId?: string;
}): BranchExecPolicyForCodexAppServer {
  if (params.permissionMode === "full") {
    return { ...resolveBranchExecPolicyForMode("full"), touched: true };
  }
  const basePolicy = resolveBranchExecPolicyFromConfig({
    config: params.config,
    agentId: params.agentId,
  });
  const overridePolicy = applyBranchExecPolicyLayer(basePolicy, params.execOverrides);
  const approvalFloors = params.approvals
    ? resolveExecApprovalsFromFile({
        file: params.approvals,
        agentId: params.agentId,
        overrides: { security: overridePolicy.security, ask: overridePolicy.ask },
      }).agent
    : undefined;
  return applyBranchExecApprovalFloors(overridePolicy, approvalFloors);
}

function applyBranchExecPolicyLayer(
  base: BranchExecPolicyForCodexAppServer,
  exec?: { mode?: unknown; security?: unknown; ask?: unknown },
): BranchExecPolicyForCodexAppServer {
  if (!exec) {
    return base;
  }
  const mode = readExecMode(exec.mode);
  if (mode !== undefined) {
    return {
      ...resolveBranchExecPolicyForMode(mode),
      touched: true,
    };
  }
  const security = readExecSecurity(exec.security);
  const ask = readExecAsk(exec.ask);
  if (security === undefined && ask === undefined) {
    return base;
  }
  const nextSecurity = security ?? base.security;
  const nextAsk = ask ?? base.ask;
  return {
    mode: execPolicy.resolveExecModePolicy({ security: nextSecurity, ask: nextAsk }).mode,
    security: nextSecurity,
    ask: nextAsk,
    touched: true,
  };
}

function applyBranchExecApprovalFloors(
  base: BranchExecPolicyForCodexAppServer,
  approvalFloors?: BranchExecApprovalFloorsForCodexAppServer,
): BranchExecPolicyForCodexAppServer {
  if (!approvalFloors) {
    return base;
  }
  const nextSecurity = approvalFloors.security
    ? execPolicy.minSecurity(base.security, approvalFloors.security)
    : base.security;
  const nextAsk = approvalFloors.ask ? execPolicy.maxAsk(base.ask, approvalFloors.ask) : base.ask;
  if (nextSecurity === base.security && nextAsk === base.ask) {
    return base;
  }
  return {
    mode: execPolicy.resolveExecModePolicy({ security: nextSecurity, ask: nextAsk }).mode,
    security: nextSecurity,
    ask: nextAsk,
    touched: true,
  };
}

function resolveBranchExecPolicyForMode(
  mode: BranchExecMode,
): Omit<BranchExecPolicyForCodexAppServer, "touched"> {
  const { security, ask } = execPolicy.resolveExecModePolicy({
    mode,
    security: "full",
    ask: "off",
  });
  return { mode, security, ask };
}

function readExecMode(value: unknown): BranchExecMode | undefined {
  return value === "deny" ||
    value === "allowlist" ||
    value === "ask" ||
    value === "auto" ||
    value === "full"
    ? value
    : undefined;
}
