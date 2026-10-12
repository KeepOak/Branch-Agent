// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/sandbox/middleware.py (atlas SAFETY-0044)
/**
 * Turns sandbox network-policy denials into Branch approval requests.
 *
 * After a sandboxed command finishes, the oldest unsurfaced proxy denial is claimed and
 * shown through the plugin approval flow. Allow once grants the destination for the
 * temporary TTL; Always allow grants it for the sandbox lifetime. Non-interactive runs
 * deny every pending event without prompting.
 */
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import {
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "../../../routing/session-key.js";
import type { HookContext, HookOutcome } from "../../agent-tools.before-tool-call.types.js";
import type { ExecToolDefaults } from "../../bash-tools.exec-types.js";
import { resolveStoredSubagentCapabilities } from "../../subagents/spawn/subagent-capabilities.js";
import type { AnyAgentTool } from "../../tools/common.js";
import type { NetworkPolicyDecision, NetworkPolicyEvent } from "./network-proxy-policy.js";
import type { SandboxNetworkPolicyClient } from "./network-proxy-sidecar.js";

const log = createSubsystemLogger("sandbox/network-proxy");

export type SandboxNetworkApprovalHandle = {
  client: SandboxNetworkPolicyClient;
  temporaryGrantTtl: number;
};

export type SandboxNetworkApprovalContext = Pick<
  HookContext,
  | "agentId"
  | "config"
  | "sessionKey"
  | "sessionId"
  | "runId"
  | "trigger"
  | "approvalReviewerDeviceId"
  | "turnSourceChannel"
  | "turnSourceTo"
  | "turnSourceAccountId"
  | "turnSourceThreadId"
> & { nonInteractive?: boolean };

/** A started sidecar mutation always drains; caller cancellation is reported afterwards. */
async function drainPolicyMutation<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const result = await operation();
  signal?.throwIfAborted();
  return result;
}

export function consumeNetworkPolicyEventsAsync(
  client: SandboxNetworkPolicyClient,
  signal?: AbortSignal,
): Promise<NetworkPolicyEvent[]> {
  return drainPolicyMutation(() => client.consumeEvents(), signal);
}

export function denyPendingNetworkPolicyEventsAsync(
  client: SandboxNetworkPolicyClient,
  signal?: AbortSignal,
): Promise<boolean> {
  return drainPolicyMutation(() => client.denyPendingEvents(), signal);
}

export function decideNetworkPolicyRequestAsync(
  client: SandboxNetworkPolicyClient,
  requestId: string,
  decision: NetworkPolicyDecision,
  signal?: AbortSignal,
): Promise<boolean> {
  return drainPolicyMutation(() => client.decide(requestId, decision), signal);
}

function formatTtlLabel(ttlSeconds: number): string {
  return ttlSeconds % 60 === 0 ? `${ttlSeconds / 60} minutes` : `${ttlSeconds} seconds`;
}

function isNonInteractive(context: SandboxNetworkApprovalContext): boolean {
  const trigger = context.trigger?.trim();
  return context.nonInteractive === true || (Boolean(trigger) && trigger !== "user");
}

function isWellFormedEvent(event: NetworkPolicyEvent | undefined): event is NetworkPolicyEvent {
  return (
    typeof event?.request_id === "string" &&
    typeof event.host === "string" &&
    Number.isInteger(event.port)
  );
}

function buildApproval(event: NetworkPolicyEvent, ttlLabel: string) {
  return {
    title: "Sandbox network access",
    description:
      `Allow this sandbox to connect to ${event.host}:${event.port}? ` +
      `Allow once grants access for ${ttlLabel}; Always allow keeps it for this sandbox. ` +
      "Private, loopback, link-local, multicast, and cloud metadata addresses can never be approved.",
    severity: "warning" as const,
    allowedDecisions: ["allow-once" as const, "allow-always" as const, "deny" as const],
  };
}

function resolveDecision(outcome: HookOutcome): NetworkPolicyDecision {
  if (outcome.blocked) {
    return "deny";
  }
  return outcome.approvalResolution === "allow-always" ? "allow_sandbox" : "allow_temporary";
}

function formatNotice(params: {
  event: NetworkPolicyEvent;
  outcome: HookOutcome;
  decision: NetworkPolicyDecision;
  applied: boolean;
  ttlLabel: string;
}): string {
  const blocked = `Sandbox network policy blocked ${params.event.host}:${params.event.port}. The command was not retried.`;
  if (!params.applied) {
    return `${blocked} The sandbox network approval is stale or does not belong to this sandbox.`;
  }
  if (params.decision === "allow_temporary") {
    return `${blocked} Network access was allowed for ${params.ttlLabel}; retry the command if appropriate.`;
  }
  if (params.decision === "allow_sandbox") {
    return `${blocked} Network access was allowed for this sandbox; retry the command if appropriate.`;
  }
  const reason = params.outcome.blocked
    ? ` (${params.outcome.reason.split("\n", 1)[0] ?? ""})`
    : "";
  return `${blocked} Network access to this destination was denied${reason}. Do not retry it.`;
}

/** Surfaces one pending proxy denial as an approval and applies the decision. */
export async function requestSandboxNetworkApproval(params: {
  handle: SandboxNetworkApprovalHandle;
  context: SandboxNetworkApprovalContext;
  toolName: string;
  toolCallId?: string;
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const { client } = params.handle;
  if (isNonInteractive(params.context)) {
    if (!(await denyPendingNetworkPolicyEventsAsync(client, params.signal))) {
      log.warn("Failed to drain sandbox network policy events for a non-interactive sandbox run");
    }
    return undefined;
  }
  const [event] = await consumeNetworkPolicyEventsAsync(client, params.signal);
  if (event === undefined) {
    return undefined;
  }
  if (!isWellFormedEvent(event)) {
    log.warn("Ignoring malformed trusted sandbox network event");
    return undefined;
  }
  const ttlLabel = formatTtlLabel(params.handle.temporaryGrantTtl);
  const { nonInteractive: _nonInteractive, ...ctx } = params.context;
  // The approval transport loads Gateway client modules; keep it off the exec import path.
  const { requestDeferredPluginToolApproval } =
    await import("../../agent-tools.before-tool-call.approval.js");
  const outcome = await requestDeferredPluginToolApproval({
    deferredApproval: {
      approval: buildApproval(event, ttlLabel),
      toolName: params.toolName,
      ...(params.toolCallId ? { toolCallId: params.toolCallId } : {}),
      ctx,
      baseParams: {},
    },
    signal: params.signal,
  });
  const decision = resolveDecision(outcome);
  const applied = await decideNetworkPolicyRequestAsync(
    client,
    event.request_id,
    decision,
    params.signal,
  );
  return formatNotice({ event, outcome, decision, applied, ttlLabel });
}

/** Mirrors the exec tool's approval routing fields; subagents never prompt. */
function resolveExecApprovalContext(defaults: ExecToolDefaults): SandboxNetworkApprovalContext {
  const sessionKey = defaults.sessionKey;
  const subagent =
    resolveStoredSubagentCapabilities(defaults.runSessionKey ?? sessionKey, {
      cfg: defaults.config,
    }).depth > 0;
  return {
    agentId:
      defaults.agentId ??
      (parseAgentSessionKey(sessionKey) ? resolveAgentIdFromSessionKey(sessionKey) : undefined),
    config: defaults.config,
    sessionKey,
    sessionId: defaults.sessionId,
    runId: defaults.runId,
    trigger: defaults.trigger,
    approvalReviewerDeviceId: defaults.approvalReviewerDeviceId,
    turnSourceChannel: defaults.messageProvider,
    turnSourceTo: defaults.currentChannelId,
    turnSourceAccountId: defaults.accountId,
    turnSourceThreadId: defaults.currentThreadTs,
    nonInteractive: defaults.nonInteractiveApproval === true || subagent,
  };
}

/** After each sandboxed exec call, surface one pending proxy denial and report the decision. */
export function withSandboxNetworkApproval(
  tool: AnyAgentTool,
  handle: SandboxNetworkApprovalHandle | undefined,
  defaults: ExecToolDefaults,
): AnyAgentTool {
  const execute = tool.execute;
  if (!handle || !execute) {
    return tool;
  }
  tool.execute = async (toolCallId, params, signal, onUpdate) => {
    const result = await execute(toolCallId, params, signal, onUpdate);
    const notice = await requestSandboxNetworkApproval({
      handle,
      context: resolveExecApprovalContext(defaults),
      toolName: tool.name,
      toolCallId,
      signal,
    });
    return appendSandboxNetworkNotice(result, notice);
  };
  return tool;
}

/** Appends the network-approval notice to a tool result's visible content. */
export function appendSandboxNetworkNotice<T extends { content: unknown[] }>(
  result: T,
  notice: string | undefined,
): T {
  if (!notice) {
    return result;
  }
  const content: unknown[] = [...result.content, { type: "text", text: notice }];
  return Object.assign({}, result, { content });
}
