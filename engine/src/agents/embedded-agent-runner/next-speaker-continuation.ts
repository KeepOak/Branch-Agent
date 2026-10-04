/**
 * Wires the next-speaker check into the embedded attempt the way gemini-cli's
 * client does (google-gemini/gemini-cli packages/core/src/core/client.ts at
 * c6bccb7ecbf6d8368d995455dd725ed34466faad): after a reply with no pending
 * tool calls, unless `skipNextSpeakerCheck` (default true) is set, ask the
 * fast model who speaks next and send "Please continue." when it is the model.
 */
import type { BranchConfig } from "../../config/types.branch.js";
import { createUtilityModelSideQuery, type SideQuery } from "../agent-loop-side-query.js";
import { checkNextSpeaker, NEXT_SPEAKER_CONTINUATION_TEXT } from "../next-speaker-check.js";
import type { AgentMessage } from "../runtime/index.js";
import { log } from "./logger.js";

/** Upstream bounds a request chain at MAX_TURNS continuations. */
export const NEXT_SPEAKER_MAX_TURNS = 100;

type ContinuationContext = {
  toolResults: readonly unknown[];
  context: { messages: AgentMessage[] };
  newMessages: AgentMessage[];
};

type ContinuableAgent = {
  signal?: AbortSignal;
  getContinuationMessages?: (context: ContinuationContext) => Promise<AgentMessage[]>;
};

/** Upstream default: model.skipNextSpeakerCheck = true. */
export function resolveSkipNextSpeakerCheck(cfg: BranchConfig | undefined): boolean {
  return cfg?.agents?.defaults?.skipNextSpeakerCheck ?? true;
}

const continuationMessages = new WeakSet<object>();

/** Continuations sent since the last tool response; upstream resets its turn budget per tool submission. */
function countTrailingContinuations(messages: readonly AgentMessage[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as object;
    if ((message as { role?: unknown }).role === "toolResult") {
      break;
    }
    if (continuationMessages.has(message)) {
      count += 1;
    }
  }
  return count;
}

export function createNextSpeakerContinuationMessage(): AgentMessage {
  const message = {
    role: "user",
    content: [{ type: "text", text: NEXT_SPEAKER_CONTINUATION_TEXT }],
    timestamp: Date.now(),
  } as AgentMessage;
  continuationMessages.add(message as object);
  return message;
}

export function installNextSpeakerContinuation(params: {
  agent: object;
  cfg: BranchConfig | undefined;
  agentId: string;
  deps?: { createSideQuery?: typeof createUtilityModelSideQuery };
}): () => void {
  const cfg = params.cfg;
  if (!cfg || resolveSkipNextSpeakerCheck(cfg)) {
    return () => {};
  }
  const agent = params.agent as ContinuableAgent;
  const previous = agent.getContinuationMessages;
  let sideQuery: SideQuery | undefined;
  agent.getContinuationMessages = async (turn) => {
    try {
      const earlier = previous ? await previous(turn) : [];
      if (earlier.length > 0) {
        return earlier;
      }
      const signal = agent.signal;
      // Only a reply with no tool calls hands the turn back to the user.
      if (!signal || signal.aborted || turn.toolResults.length > 0) {
        return [];
      }
      if (countTrailingContinuations(turn.newMessages) >= NEXT_SPEAKER_MAX_TURNS) {
        return [];
      }
      sideQuery ??= (params.deps?.createSideQuery ?? createUtilityModelSideQuery)({
        cfg,
        agentId: params.agentId,
      });
      const nextSpeaker = await checkNextSpeaker({
        messages: turn.context.messages,
        sideQuery,
        abortSignal: signal,
        onWarn: (message, error) => log.warn(`${message} ${String(error)}`),
      });
      if (nextSpeaker?.next_speaker !== "model" || signal.aborted) {
        return [];
      }
      return [createNextSpeakerContinuationMessage()];
    } catch (error) {
      log.warn(`next-speaker check failed: ${String(error)}`);
      return [];
    }
  };
  return () => {
    agent.getContinuationMessages = previous;
  };
}
