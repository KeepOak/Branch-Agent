import type { Block } from "./model";

/** Follow-ups are derived only from the latest real reply, never an older turn or a canned conversation. */
export function suggestionsFor(history: readonly Block[], running: boolean, pendingUser: boolean): string[] {
  if (running || pendingUser) return [];
  // After you stopped it, the one thing to offer is to carry on (the preview's "Say “carry on”…").
  const turnEnd = [...history].reverse().find((block) => block.kind === "user" || block.kind === "done");
  if (turnEnd?.kind === "done" && turnEnd.stopped) return ["Carry on"];
  const last = [...history].reverse().find((block) => block.kind === "user" || block.kind === "text");
  if (!last || last.kind !== "text") return [];
  const words = last.text.trim();
  const lower = words.toLowerCase();
  const answer: string[] = [];
  const question = words.match(/[^.!?]*\?\s*$/)?.[0]?.trim();
  if (question) {
    const offer = question.match(/^(?:want me to|shall i|should i|do you want me to)\s+(.+?)\?$/i);
    if (offer) answer.push("Yes, please", "Not now");
    else answer.push("Yes", "No");
  }
  if (/library|saved .*\.(md|pdf|xlsx)|\b\w+\.(xlsx|pdf|md)\b/i.test(words)) answer.push("Open it");
  if (/stopped|paused/i.test(lower)) answer.push("Carry on");
  if (words.length > 600) answer.push("Make it shorter");
  return [...new Set(answer)].slice(0, 3);
}
