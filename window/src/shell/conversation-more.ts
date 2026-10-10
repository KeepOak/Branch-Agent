/** Preview headDotT5: count and label for the chat header ⋯ when this conversation needs you. */

export const CONVERSATION_MORE_IDLE_LABEL = "Conversation menu";

/** Inbox › Needs you items that belong to this conversation: pending approvals + pending questions. */
export function conversationNeedsCount(approvalsWaiting: number, questionsWaiting: number): number {
  return Math.max(0, approvalsWaiting) + Math.max(0, questionsWaiting);
}

/** Pending questions still waiting, matching the header's wait-face filter. */
export function pendingQuestionCount(questions: readonly { status: string; expiresAtMs?: number }[], now: number): number {
  return questions.filter((question) => question.status === "pending" && (!question.expiresAtMs || question.expiresAtMs > now)).length;
}

/** Approvals already keyed by conversation, plus this conversation's pending questions. */
export function conversationNeedsYou(
  approvalsByKey: Map<string, number>,
  sessionKey: string | null | undefined,
  questions: readonly { status: string; expiresAtMs?: number }[],
  now: number,
): number {
  if (!sessionKey) return 0;
  return conversationNeedsCount(approvalsByKey.get(sessionKey) ?? 0, pendingQuestionCount(questions, now));
}

/** Idle ⋯ stays labelled as today; with N waiting it becomes "More for this conversation, N need you". */
export function conversationMoreLabel(need: number, idleLabel: string = CONVERSATION_MORE_IDLE_LABEL): string {
  if (need <= 0) return idleLabel;
  return `More for this conversation, ${need} ${need === 1 ? "needs" : "need"} you`;
}
