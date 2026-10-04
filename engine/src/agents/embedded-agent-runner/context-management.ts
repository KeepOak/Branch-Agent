/**
 * gemini-cli context management for embedded attempts (google-gemini/gemini-cli
 * at c6bccb7ecbf6d8368d995455dd725ed34466faad). Off unless
 * `agents.defaults.contextManagement.enabled` is true, as upstream's
 * `contextManagement.enabled` defaults to false. When on:
 * - tool outputs over the distillation budget are saved to disk, truncated and
 *   given an intent summary (scheduler/tool-executor.ts truncateOutputIfNeeded);
 * - oversized parts of each new request are distilled by the utility model
 *   (generalist profile "ImmediateNodeDistillation" on `new_message`).
 */
import { createHash } from "node:crypto";
import type { BranchConfig } from "../../config/types.branch.js";
import { createUtilityModelSideQuery, type SideQuery } from "../agent-loop-side-query.js";
import { createNodeDistillationProcessor, type ContextProcessor } from "../node-distillation.js";
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

export function installContextManagement(params: {
  agent: object;
  cfg: BranchConfig | undefined;
  agentId: string;
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
  return () => {
    removeNodeDistillation();
    removeToolDistillation();
  };
}
