/**
 * Fires the tool-use batch label after each completed tool batch, mirroring
 * qwen-code's useLlmStream trigger (QwenLM/qwen-code
 * packages/cli/src/ui/hooks/use-llm-stream.ts at 728c13de219885de6a3e93223460c3ec8a8f690d):
 * successful tools only, fire-and-forget, dropped when cancelled or when a
 * newer batch landed first, main session only.
 */
import type { ToolResultMessage } from "branch/plugin-sdk/llm";
import { emitAgentEvent } from "../infra/agent-events.js";
import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { createUtilityModelSideQuery, type SideQuery } from "./agent-loop-side-query.js";
import { emitAgentEventCallbackBestEffort } from "./embedded-agent-subscribe.handlers.tools.start.js";
import type { EmbeddedAgentSubscribeContext } from "./embedded-agent-subscribe.handlers.types.js";
import type { AgentMessage } from "./runtime/index.js";
import {
  createToolUseSummaryMessage,
  generateToolUseSummary,
  type ToolInfo,
} from "./tool-use-summary.js";

/** Agent event stream carrying `ToolUseSummaryMessage` payloads. */
export const TOOL_USE_SUMMARY_EVENT_STREAM = "tool_use_summary";

type TurnEndEvent = { message: AgentMessage; toolResults: ToolResultMessage[] };

const latestBatchByState = new WeakMap<object, number>();

function textOf(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block: unknown) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("");
}

function toolCallArgsById(message: AgentMessage): Map<string, unknown> {
  const args = new Map<string, unknown>();
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return args;
  }
  for (const block of content as unknown[]) {
    const call = block as { type?: unknown; id?: unknown; arguments?: unknown };
    if (call?.type === "toolCall" && typeof call.id === "string") {
      args.set(call.id, call.arguments);
    }
  }
  return args;
}

export function resolveEmitToolUseSummaries(ctx: EmbeddedAgentSubscribeContext): boolean {
  // Upstream default: experimental.emitToolUseSummaries = true.
  return ctx.params.config?.agents?.defaults?.emitToolUseSummaries ?? true;
}

/** Starts label generation for the batch ended by `evt`; never awaited by the event chain. */
export function maybeEmitToolUseSummary(
  ctx: EmbeddedAgentSubscribeContext,
  evt: TurnEndEvent,
  deps: { createSideQuery?: typeof createUtilityModelSideQuery } = {},
): void {
  const cfg = ctx.params.config;
  const agentId = ctx.params.agentId;
  if (!cfg || !agentId || !resolveEmitToolUseSummaries(ctx)) {
    return;
  }
  // Subagents run their own loop upstream and never get labels.
  if (isSubagentSessionKey(ctx.params.sessionKey)) {
    return;
  }
  // Only summarize successful tools: failures produce misleading labels.
  const successful = evt.toolResults.filter((result) => !result.isError);
  if (successful.length === 0) {
    return;
  }
  const argsById = toolCallArgsById(evt.message);
  const tools: ToolInfo[] = successful.map((result) => ({
    name: result.toolName,
    input: argsById.get(result.toolCallId),
    output: textOf(result.content),
  }));
  const toolUseIds = successful.map((result) => result.toolCallId);
  const batch = (latestBatchByState.get(ctx.state) ?? 0) + 1;
  latestBatchByState.set(ctx.state, batch);

  const summaryAbort = new AbortController();
  // Ctrl+C on the run cancels its in-flight label, as upstream's turn abort does.
  const runSignal = (ctx.params.session as { agent?: { signal?: AbortSignal } }).agent?.signal;
  runSignal?.addEventListener("abort", () => summaryAbort.abort(), { once: true });
  let sideQuery: SideQuery | undefined;
  try {
    sideQuery = (deps.createSideQuery ?? createUtilityModelSideQuery)({
      cfg,
      agentId,
      requireUtilityModel: true,
    });
  } catch {
    sideQuery = undefined;
  }
  void generateToolUseSummary({
    sideQuery,
    tools,
    signal: summaryAbort.signal,
    lastAssistantText: textOf((evt.message as { content?: unknown }).content),
    onDebug: (message) => ctx.log.debug(`tool-use summary: ${message}`),
  })
    .then((summary) => {
      const cancelled = summaryAbort.signal.aborted || runSignal?.aborted === true;
      // Stale: a newer batch landed while the label was in flight.
      if (!summary || cancelled || latestBatchByState.get(ctx.state) !== batch) {
        return;
      }
      const data = { ...createToolUseSummaryMessage(summary, toolUseIds) };
      emitAgentEvent({
        runId: ctx.params.runId,
        ...(ctx.params.sessionKey ? { sessionKey: ctx.params.sessionKey } : {}),
        stream: TOOL_USE_SUMMARY_EVENT_STREAM,
        data,
      });
      emitAgentEventCallbackBestEffort(ctx, { stream: TOOL_USE_SUMMARY_EVENT_STREAM, data });
    })
    .catch(() => {});
}
