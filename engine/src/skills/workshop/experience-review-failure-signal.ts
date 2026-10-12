import { isRecord } from "@branch/normalization-core/record-coerce";

/**
 * Deterministic "repeated failure overcome" signal for one run's messages.
 * It returns the identity of the first tool call that failed and was later
 * overcome by a successful call of the same tool and command head. It reads
 * message shape only and never calls a model.
 * A failure is either `isError` or a non-zero `details.exitCode`, which exec reports
 * for a normal exit with a non-zero code. A success carries no error text, so the
 * match is on call identity alone. Calls without a command or path are not tracked.
 */
export function findOvercomeRepeatedFailureIdentity(
  messages: readonly unknown[],
): string | undefined {
  const callKeys = new Map<string, string>();
  const failedKeys = new Set<string>();
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    if (message.role === "assistant") {
      recordToolCallKeys(message, callKeys);
      continue;
    }
    if (message.role !== "toolResult" || typeof message.toolCallId !== "string") {
      continue;
    }
    const key = callKeys.get(message.toolCallId);
    if (key === undefined) {
      continue;
    }
    if (isFailedToolResult(message)) {
      failedKeys.add(key);
    } else if (failedKeys.has(key)) {
      return key;
    }
  }
  return undefined;
}

function isFailedToolResult(message: Record<string, unknown>): boolean {
  if (message.isError === true) {
    return true;
  }
  const exitCode = isRecord(message.details) ? message.details.exitCode : undefined;
  return typeof exitCode === "number" && exitCode !== 0;
}

function recordToolCallKeys(message: Record<string, unknown>, callKeys: Map<string, string>): void {
  if (!Array.isArray(message.content)) {
    return;
  }
  for (const block of message.content) {
    if (
      isRecord(block) &&
      block.type === "toolCall" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      const key = toolCallKey(block.name, isRecord(block.arguments) ? block.arguments : {});
      if (key !== undefined) {
        callKeys.set(block.id, key);
      }
    }
  }
}

/** Tool name plus the first two words of its command or path, lowercased. */
function toolCallKey(name: string, args: Record<string, unknown>): string | undefined {
  const target = [args.command, args.cmd, args.path].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  if (target === undefined) {
    return undefined;
  }
  const head = target.trim().split(/\s+/u).slice(0, 2).join(" ").toLowerCase();
  return JSON.stringify([name, head]);
}
