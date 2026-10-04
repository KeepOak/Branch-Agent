// Ported from google-gemini/gemini-cli packages/core/src/utils/nextSpeakerChecker.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
import type { SideQuery } from "./agent-loop-side-query.js";
import { formatMessagesForLlm } from "./format-messages-for-llm.js";
import type { AgentMessage } from "./runtime/index.js";

export const CHECK_PROMPT = `Analyze *only* the content and structure of your immediately preceding response (your last turn in the conversation history). Based *strictly* on that response, determine who should logically speak next: the 'user' or the 'model' (you).
**Decision Rules (apply in order):**
1.  **Model Continues:** If your last response explicitly states an immediate next action *you* intend to take (e.g., "Next, I will...", "Now I'll process...", "Moving on to analyze...", indicates an intended tool call that didn't execute), OR if the response seems clearly incomplete (cut off mid-thought without a natural conclusion), then the **'model'** should speak next.
2.  **Question to User:** If your last response ends with a direct question specifically addressed *to the user*, then the **'user'** should speak next.
3.  **Waiting for User:** If your last response completed a thought, statement, or task *and* does not meet the criteria for Rule 1 (Model Continues) or Rule 2 (Question to User), it implies a pause expecting user input or reaction. In this case, the **'user'** should speak next.`;

export const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description:
        "Brief explanation justifying the 'next_speaker' choice based *strictly* on the applicable rule and the content/structure of the preceding turn.",
    },
    next_speaker: {
      type: "string",
      enum: ["user", "model"],
      description: "Who should speak next based *only* on the preceding turn and the decision rules",
    },
  },
  required: ["reasoning", "next_speaker"],
};

/**
 * Upstream requests structured JSON output against RESPONSE_SCHEMA; the
 * utility-model side call is prompt-only, so the schema travels as the
 * system instruction.
 */
export const NEXT_SPEAKER_SYSTEM_PROMPT = `Respond with only a JSON object that matches this JSON schema:\n${JSON.stringify(RESPONSE_SCHEMA)}`;

/** Upstream continuation request sent when the model should speak next. */
export const NEXT_SPEAKER_CONTINUATION_TEXT = "Please continue.";

export interface NextSpeakerResponse {
  reasoning: string;
  next_speaker: "user" | "model";
}

function roleOf(message: AgentMessage | undefined): unknown {
  return (message as { role?: unknown } | undefined)?.role;
}

function contentOf(message: AgentMessage): unknown[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content ? [content] : [];
  }
  return Array.isArray(content) ? content : [];
}

/**
 * Curated history drops turns the endpoint would reject: model turns with no
 * content, failed or aborted replies, and non-transcript entries.
 */
function curateHistory(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => {
    const role = roleOf(message);
    if (role === "assistant") {
      const stopReason = (message as { stopReason?: unknown }).stopReason;
      return contentOf(message).length > 0 && stopReason !== "error" && stopReason !== "aborted";
    }
    return role === "user" || role === "toolResult";
  });
}

/** Strips a ```json fence, as upstream's generateJson does. */
function cleanJsonResponse(text: string): string {
  const prefix = "```json";
  const suffix = "```";
  const trimmed = text.trim();
  if (trimmed.startsWith(prefix) && trimmed.endsWith(suffix)) {
    return trimmed.substring(prefix.length, trimmed.length - suffix.length).trim();
  }
  return trimmed;
}

export async function checkNextSpeaker(params: {
  messages: readonly AgentMessage[];
  sideQuery: SideQuery;
  abortSignal?: AbortSignal;
  onWarn?: (message: string, error: unknown) => void;
}): Promise<NextSpeakerResponse | null> {
  // Capture the curated history: model turns that are invalid (e.g. an empty
  // part collection) would break the side call when passed back up.
  const curatedHistory = curateHistory(params.messages);

  // Ensure there's a model response to analyze
  if (curatedHistory.length === 0) {
    // Cannot determine next speaker if history is empty.
    return null;
  }

  const comprehensiveHistory = params.messages;
  // If comprehensiveHistory is empty, there is no last message to check.
  if (comprehensiveHistory.length === 0) {
    return null;
  }
  const lastComprehensiveMessage = comprehensiveHistory[comprehensiveHistory.length - 1];

  // If the last message is a tool result, then the model should speak next.
  if (lastComprehensiveMessage && roleOf(lastComprehensiveMessage) === "toolResult") {
    return {
      reasoning: "The last message was a function response, so the model should speak next.",
      next_speaker: "model",
    };
  }

  if (
    lastComprehensiveMessage &&
    roleOf(lastComprehensiveMessage) === "assistant" &&
    contentOf(lastComprehensiveMessage).length === 0
  ) {
    return {
      reasoning:
        "The last message was a filler model message with no content (nothing for user to act on), model should speak next.",
      next_speaker: "model",
    };
  }

  // Things checked out. Let's proceed to potentially making an LLM request.

  const lastMessage = curatedHistory[curatedHistory.length - 1];
  if (!lastMessage || roleOf(lastMessage) !== "assistant") {
    // Cannot determine next speaker if the last turn wasn't from the model.
    return null;
  }

  try {
    const text = await params.sideQuery({
      systemPrompt: NEXT_SPEAKER_SYSTEM_PROMPT,
      prompt: `${formatMessagesForLlm(curatedHistory, {
        maxToolResponseChars: Number.POSITIVE_INFINITY,
      })}\n${CHECK_PROMPT}`,
      ...(params.abortSignal ? { signal: params.abortSignal } : {}),
    });
    const parsedResponse = (text ? JSON.parse(cleanJsonResponse(text)) : null) as
      | Partial<NextSpeakerResponse>
      | null;

    if (
      parsedResponse &&
      parsedResponse.next_speaker &&
      ["user", "model"].includes(parsedResponse.next_speaker)
    ) {
      return parsedResponse as NextSpeakerResponse;
    }
    return null;
  } catch (error) {
    params.onWarn?.(
      "Failed to talk to the utility model when seeing if conversation should continue.",
      error,
    );
    return null;
  }
}
