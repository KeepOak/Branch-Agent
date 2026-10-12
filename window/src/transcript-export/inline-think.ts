// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/components/conversation-events/chat/event-thought-helpers.ts (atlas SESSIONS-0047). Leading-think helper copied unchanged.
/**
 * Splits a leading `<think>…</think>` reasoning block out of assistant content
 * so it renders in the collapsible thinking section, not the message bubble.
 * Some models stream reasoning inline instead of via `reasoning_content`.
 *
 * Conservative to avoid mangling normal messages: only a `<think>` at the very
 * start is touched (later occurrences, e.g. quoted in docs, stay verbatim),
 * only the first block is peeled, and an unclosed leading `<think>` is reasoning
 * only while `streaming` — in a finalized message it's literal output.
 */
export const splitInlineThink = (
  content: string,
  options?: { streaming?: boolean },
): { reasoning: string; message: string } => {
  const OPEN = "<think>";
  const CLOSE = "</think>";

  // Only a <think> at the very start is reasoning.
  const leading = content.replace(/^\s+/, "");
  if (!leading.startsWith(OPEN)) {
    return { reasoning: "", message: content };
  }

  const afterOpen = leading.slice(OPEN.length);
  const close = afterOpen.indexOf(CLOSE);

  if (close === -1) {
    // Unclosed: reasoning-in-progress while streaming, else literal output.
    return options?.streaming
      ? { reasoning: afterOpen.trim(), message: "" }
      : { reasoning: "", message: content };
  }

  return {
    reasoning: afterOpen.slice(0, close).trim(),
    message: afterOpen.slice(close + CLOSE.length).trim(),
  };
};

