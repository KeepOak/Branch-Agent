import {
  extractToolErrorMessage,
  type AgentMessage,
} from "branch/plugin-sdk/agent-harness-runtime";
import { redactSensitiveText } from "branch/plugin-sdk/security-runtime";
import {
  normalizeOptionalString,
  readStringField as readString,
} from "branch/plugin-sdk/string-coerce-runtime";
import { isNonSuccessItemStatus, type itemStatus } from "./event-projector-items.js";
import { itemToolError } from "./event-projector-tool-items.js";
import type { ToolTranscriptResultInput } from "./event-projector-tool-progress.js";
import { isJsonObject, type CodexThreadItem } from "./protocol.js";

export type ToolTranscriptFailureInput = ToolTranscriptResultInput & { failureText?: string };

export function nativeCodexToolFailureText(
  item: CodexThreadItem,
  status: ReturnType<typeof itemStatus>,
  outputTextByItem?: ReadonlyMap<string, string>,
): string | undefined {
  return (
    (isNonSuccessItemStatus(status) && isJsonObject(item.error)
      ? normalizeOptionalString(readString(item.error, "message"))
      : undefined) ?? itemToolError(item, status, outputTextByItem)
  );
}

export function summarizeUnmentionedCodexToolFailures(
  messages: readonly AgentMessage[],
  assistantTexts: readonly string[],
): string | undefined {
  const progressTexts = messages.flatMap((message) =>
    message.role === "assistant"
      ? message.content.flatMap((block) => {
          if (block.type !== "toolCall" || block.name !== "progress_card") {
            return [];
          }
          const result = messages.find(
            (candidate) => candidate.role === "toolResult" && candidate.toolCallId === block.id,
          );
          return result?.role === "toolResult" &&
            !result.isError &&
            typeof block.arguments.markdown === "string"
            ? [block.arguments.markdown]
            : [];
        })
      : [],
  );
  const mentionedTexts = [...assistantTexts, ...progressTexts].map((text) =>
    text.replace(/\s+/gu, " ").toLowerCase(),
  );
  const failures = messages.flatMap((message) => {
    if (message.role !== "toolResult" || !message.isError) {
      return [];
    }
    const details = isJsonObject(message.details) ? message.details : undefined;
    if (details?.reason === "missing_tool_result") {
      return [];
    }
    const reason = typeof details?.failureReason === "string" ? details.failureReason : undefined;
    const hasDistinctToolFailure = messages.some(
      (candidate) =>
        candidate.role === "toolResult" &&
        candidate.isError &&
        candidate.toolName === message.toolName &&
        isJsonObject(candidate.details) &&
        candidate.details.reason !== "missing_tool_result" &&
        typeof candidate.details.failureReason === "string" &&
        candidate.details.failureReason !== reason,
    );
    if (
      !reason ||
      /^codex native tool (?:failed|blocked)$/iu.test(reason) ||
      mentionedTexts.some(
        (text) =>
          text.includes(reason.toLowerCase()) ||
          (!hasDistinctToolFailure &&
            text
              .split(/[.!?]/u)
              .some(
                (sentence) =>
                  (sentence.includes(message.toolName.toLowerCase()) ||
                    sentence.includes(message.toolName.replaceAll("_", " ").toLowerCase())) &&
                  /\b(?:failed|failure|error|blocked|denied|timed out|could not|couldn't|unable)\b/u.test(
                    sentence,
                  ),
              )),
      )
    ) {
      return [];
    }
    return [`${message.toolName} — ${reason}`];
  });
  const uniqueFailures = [...new Set(failures)];
  const listedFailures = uniqueFailures.slice(0, 3);
  if (uniqueFailures.length > listedFailures.length) {
    listedFailures.push(`and ${uniqueFailures.length - listedFailures.length} more`);
  }
  return uniqueFailures.length
    ? `${uniqueFailures.length} ${uniqueFailures.length === 1 ? "step" : "steps"} failed: ${listedFailures.join("; ")}`
    : undefined;
}

export function withCodexToolFailureReason(
  baseMessage: Extract<AgentMessage, { role: "toolResult" }>,
  params: ToolTranscriptFailureInput,
  response: string | undefined,
): Extract<AgentMessage, { role: "toolResult" }> {
  const errorText =
    params.failureText ??
    baseMessage.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  const failureReason =
    params.isError && !params.outcomeUnknown
      ? extractToolErrorMessage({
          content: [{ type: "text", text: redactSensitiveText(errorText, { mode: "tools" }) }],
          isError: true,
        })
          ?.replace(/\s+/gu, " ")
          .trim()
      : undefined;
  return {
    ...baseMessage,
    // Execution-only JSON is a projection, not a provider response receipt.
    // Give the existing step renderer plain failure text, preserving raw
    // provider responses and successful transcript content byte-for-byte.
    ...(failureReason && response === undefined && params.text?.trimStart().startsWith("{")
      ? { content: [{ type: "text" as const, text: failureReason }] }
      : {}),
    ...(failureReason
      ? {
          details: {
            ...(isJsonObject(params.details)
              ? params.details
              : params.details === undefined
                ? {}
                : { toolDetails: params.details }),
            failureReason,
          },
        }
      : {}),
  };
}
