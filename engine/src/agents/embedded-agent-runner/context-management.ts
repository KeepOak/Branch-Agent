/**
 * gemini-cli context management for embedded attempts (google-gemini/gemini-cli
 * at c6bccb7ecbf6d8368d995455dd725ed34466faad). Off unless
 * `agents.defaults.contextManagement.enabled` is true, as upstream's
 * `contextManagement.enabled` defaults to false. When on:
 * - tool outputs over the distillation budget are saved to disk, truncated and
 *   given an intent summary (scheduler/tool-executor.ts truncateOutputIfNeeded);
 * - oversized parts of each new request are distilled by the utility model
 *   (generalist profile "ImmediateNodeDistillation" on `new_message`);
 * - over the generalist maxTokens budget, messages older than the retained
 *   window fold into one rolling summary (RollingSummaryProcessor in the
 *   `gc_backstop` slot of render.ts; upstream registers the processor but no
 *   built-in profile runs it).
 */
import { createHash } from "node:crypto";
import type { BranchConfig } from "../../config/types.branch.js";
import { createUtilityModelSideQuery, type SideQuery } from "../agent-loop-side-query.js";
import { createNodeDistillationProcessor, type ContextProcessor } from "../node-distillation.js";
import {
  createRollingSummaryProcessor,
  estimateMessageTokens,
  isRollingSummaryMessage,
} from "../rolling-summary.js";
import type { AgentMessage } from "../runtime/index.js";
import { writePrivateTempFile } from "../sessions/tools/private-temp-file.js";
import {
  DEFAULT_TOOL_MAX_OUTPUT_TOKENS,
  DEFAULT_TOOL_SUMMARIZATION_THRESHOLD_TOKENS,
  ToolOutputDistillationService,
  type ToolOutputContent,
} from "../tool-output-distillation.js";
import { log } from "./logger.js";

/** Generalist profile: ImmediateNodeDistillation nodeThresholdTokens. */
export const IMMEDIATE_NODE_DISTILLATION_THRESHOLD_TOKENS = 15_000;

export type ContextManagementSettings = {
  enabled: boolean;
  maxOutputTokens: number;
  summarizationThresholdTokens: number;
};

export function resolveContextManagementSettings(
  cfg: BranchConfig | undefined,
): ContextManagementSettings {
  const contextManagement = cfg?.agents?.defaults?.contextManagement;
  const distillation = contextManagement?.tools?.distillation;
  return {
    enabled: contextManagement?.enabled ?? false,
    maxOutputTokens: distillation?.maxOutputTokens ?? DEFAULT_TOOL_MAX_OUTPUT_TOKENS,
    summarizationThresholdTokens:
      distillation?.summarizationThresholdTokens ?? DEFAULT_TOOL_SUMMARIZATION_THRESHOLD_TOKENS,
  };
}

export type ContextManagementDeps = {
  createSideQuery?: typeof createUtilityModelSideQuery;
  saveOutput?: (content: string, toolName: string, callId: string) => Promise<string>;
};

type AfterToolCall = (
  context: {
    toolCall: { id: string; name: string };
    result: { content: unknown };
  },
  signal?: AbortSignal,
) => Promise<{ content?: unknown; details?: unknown; isError?: boolean } | undefined>;

type TransformContext = (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

type ManagedAgent = { afterToolCall?: AfterToolCall; transformContext?: TransformContext };

async function saveToolOutput(content: string, toolName: string): Promise<string> {
  const safeToolName = toolName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "tool";
  return await writePrivateTempFile(`branch-tool-output-${safeToolName}`, content);
}

function installToolOutputDistillation(
  agent: ManagedAgent,
  settings: ContextManagementSettings,
  engineMaxChars: number | undefined,
  sideQuery: SideQuery,
  deps: ContextManagementDeps,
): () => void {
  const previous = agent.afterToolCall;
  const service = new ToolOutputDistillationService({ ...settings, engineMaxChars }, {
    sideQuery,
    saveOutput: deps.saveOutput ?? ((content, toolName) => saveToolOutput(content, toolName)),
    onDebug: (message) => log.debug(`[context-management] ${message}`),
  });
  agent.afterToolCall = async (context, signal) => {
    const base = previous ? await previous(context, signal) : undefined;
    const content = (base?.content ?? context.result.content) as ToolOutputContent;
    // Tool results here always carry content blocks.
    if (!Array.isArray(content)) {
      return base;
    }
    const distilled = await service.distill(context.toolCall.name, context.toolCall.id, content);
    if (distilled.truncatedContent === content) {
      return base;
    }
    return { ...base, content: distilled.truncatedContent };
  };
  return () => {
    agent.afterToolCall = previous;
  };
}

function messageKey(message: AgentMessage): string {
  const record = message as {
    role?: unknown;
    timestamp?: unknown;
    toolCallId?: unknown;
    content?: unknown;
  };
  return createHash("sha256")
    .update(
      JSON.stringify([record.role, record.timestamp, record.toolCallId ?? null, record.content]),
    )
    .digest("hex");
}

/** Distilled replacements outlive one attempt, like upstream's working buffer. */
const distilledByKey = new Map<string, AgentMessage>();

/** Messages after the last assistant reply form the request being sent. */
function pendingRequestStart(messages: readonly AgentMessage[]): number {
  let start = messages.length;
  while (start > 0 && (messages[start - 1] as { role?: unknown }).role !== "assistant") {
    start -= 1;
  }
  return start;
}

function installImmediateNodeDistillation(agent: ManagedAgent, processor: ContextProcessor) {
  const previous = agent.transformContext;
  const evaluated = new Set<string>();
  agent.transformContext = async (messages, signal) => {
    const source = previous ? await previous.call(agent, messages, signal) : messages;
    try {
      const start = pendingRequestStart(source);
      let changed = false;
      const output = source.slice();
      for (let index = 0; index < source.length; index += 1) {
        const message = source[index] as AgentMessage;
        const key = messageKey(message);
        let replacement = distilledByKey.get(key);
        if (!replacement && index >= start && !evaluated.has(key)) {
          evaluated.add(key);
          const [processed] = await processor.process({ targets: [message] });
          if (processed && processed !== message) {
            distilledByKey.set(key, processed);
            replacement = processed;
          }
        }
        if (replacement) {
          output[index] = replacement;
          changed = true;
        }
      }
      return changed ? output : source;
    } catch (error) {
      log.warn(`[context-management] node distillation failed: ${String(error)}`);
      return source;
    }
  };
  return () => {
    agent.transformContext = previous;
  };
}

/** Generalist profile budget. */
export const CONTEXT_BUDGET_MAX_TOKENS = 150_000;
export const CONTEXT_BUDGET_RETAINED_TOKENS = 65_000;

type RollingState = { consumedKeys: Set<string>; summary: AgentMessage };

/** One rolling summary per session, like upstream's per-chat working buffer. */
const rollingStateBySession = new Map<string, RollingState>();

function textOfMessage(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content)
    ? content.map((block: { text?: unknown }) => (typeof block.text === "string" ? block.text : "")).join("")
    : String(content ?? "");
}

/** Re-applies the session's last rolling summary over the messages it consumed. */
function applyRollingState(
  messages: readonly AgentMessage[],
  keys: readonly string[],
  state: RollingState,
): AgentMessage[] | undefined {
  const firstIndex = keys.findIndex((key) => state.consumedKeys.has(key));
  if (firstIndex === -1) {
    return undefined;
  }
  const output: AgentMessage[] = [];
  messages.forEach((message, index) => {
    if (index === firstIndex) {
      output.push(state.summary);
    }
    if (!state.consumedKeys.has(keys[index] ?? "")) {
      output.push(message);
    }
  });
  return output;
}

/**
 * gc_backstop targets (render.ts, 'bulk' strategy): over maxTokens, every
 * message older than the newest retainedTokens. The request being sent is
 * never aged out, and a tool result is never split from its call.
 */
function backstopTargetCount(messages: readonly AgentMessage[]): number {
  const total = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  if (total <= CONTEXT_BUDGET_MAX_TOKENS) {
    return 0;
  }
  let rollingTokens = 0;
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const priorTokens = rollingTokens;
    rollingTokens += estimateMessageTokens(messages[index] as AgentMessage);
    if (priorTokens > CONTEXT_BUDGET_RETAINED_TOKENS) {
      count = index + 1;
      break;
    }
  }
  count = Math.min(count, pendingRequestStart(messages));
  while (count > 0 && (messages[count] as { role?: unknown } | undefined)?.role === "toolResult") {
    count -= 1;
  }
  return count;
}

function installRollingSummaryBackstop(
  agent: ManagedAgent,
  processor: ContextProcessor,
  sessionKey: string | undefined,
) {
  const previous = agent.transformContext;
  let localState: RollingState | undefined;
  const readState = () => (sessionKey ? rollingStateBySession.get(sessionKey) : localState);
  const writeState = (state: RollingState | undefined) => {
    if (!sessionKey) {
      localState = state;
    } else if (state) {
      rollingStateBySession.set(sessionKey, state);
    } else {
      rollingStateBySession.delete(sessionKey);
    }
  };
  agent.transformContext = async (messages, signal) => {
    const source = previous ? await previous.call(agent, messages, signal) : messages;
    try {
      const keys = source.map(messageKey);
      const state = readState();
      const applied = state ? applyRollingState(source, keys, state) : undefined;
      if (state && !applied) {
        writeState(undefined); // The summarized messages are gone (e.g. compacted).
      }
      const current = applied ?? source;
      const count = backstopTargetCount(current);
      if (count < 2) {
        return current;
      }
      const targets = current.slice(0, count);
      const processed = await processor.process({ targets });
      const kept = new Set(processed);
      const summary = processed.find((message) => !targets.includes(message));
      // An empty reply would leave an empty request message in place of the history.
      if (!summary || !isRollingSummaryMessage(summary) || !textOfMessage(summary)) {
        return current;
      }
      const consumedKeys = new Set<string>();
      for (const target of targets) {
        if (kept.has(target)) {
          continue;
        }
        if (state && target === state.summary) {
          state.consumedKeys.forEach((key) => consumedKeys.add(key));
        } else {
          consumedKeys.add(messageKey(target));
        }
      }
      writeState({ consumedKeys, summary });
      return [...processed, ...current.slice(count)];
    } catch (error) {
      log.warn(`[context-management] rolling summary failed: ${String(error)}`);
      return source;
    }
  };
  return () => {
    agent.transformContext = previous;
  };
}

export function installContextManagement(params: {
  agent: object;
  cfg: BranchConfig | undefined;
  agentId: string;
  /** Session whose rolling summary persists across attempts. */
  sessionId?: string;
  /** The engine's live per-result cap for this attempt's context window. */
  liveToolResultMaxChars?: number;
  deps?: ContextManagementDeps;
}): () => void {
  const settings = resolveContextManagementSettings(params.cfg);
  if (!params.cfg || !settings.enabled) {
    return () => {};
  }
  const agent = params.agent as ManagedAgent;
  const deps = params.deps ?? {};
  const sideQuery = (deps.createSideQuery ?? createUtilityModelSideQuery)({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const removeToolDistillation = installToolOutputDistillation(
    agent,
    settings,
    params.liveToolResultMaxChars,
    sideQuery,
    deps,
  );
  const removeNodeDistillation = installImmediateNodeDistillation(
    agent,
    createNodeDistillationProcessor(
      "ImmediateNodeDistillation",
      {
        sideQuery,
        onWarn: (message, error) => log.warn(`[context-management] ${message}: ${String(error)}`),
      },
      { nodeThresholdTokens: IMMEDIATE_NODE_DISTILLATION_THRESHOLD_TOKENS },
    ),
  );
  // Emergency backstop over maxTokens: fold aged-out messages into one rolling summary.
  const removeRollingSummary = installRollingSummaryBackstop(
    agent,
    createRollingSummaryProcessor(
      "RollingSummaryBackstop",
      {
        sideQuery,
        onError: (message, error) => log.warn(`[context-management] ${message}: ${String(error)}`),
      },
      { target: "max" },
    ),
    params.sessionId,
  );
  return () => {
    removeRollingSummary();
    removeNodeDistillation();
    removeToolDistillation();
  };
}
