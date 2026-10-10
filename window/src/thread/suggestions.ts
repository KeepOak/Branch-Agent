import type { Block } from "./model";

/** Preview wording (`chipsForT5`): curly apostrophe in “Don’t send it yet”. */
const DONT_SEND = "Don\u2019t send it yet";

function pendingAskChips(history: readonly Block[]): string[] | undefined {
  const ask = history.slice(-4).reverse().find(
    (block): block is Extract<Block, { kind: "approval" }> =>
      block.kind === "approval" && block.approval.state === "pending",
  );
  if (!ask) return undefined;
  const q = ask.approval.command;
  if (/email|send/i.test(q)) return ["Show me the email first", "Send it", DONT_SEND];
  if (/command|run/i.test(q)) return ["What does it do?", "Run it", "Not now"];
  return ["Yes, go ahead", "Tell me more first", "Not now"];
}

/**
 * Prefer no chip to guessing: a question mark alone does not imply a binary choice.
 * Only questions that ask whether a statement holds ("Is this right?", "Did you get it?") count.
 * Modal forms ("Can you…", "Could you…", "Would you…") ask for something, so they never do.
 */
function isConfirmation(question: string): boolean {
  // A wh-word or an alternative makes the answer something other than yes or no.
  if (/\b(?:or|what|which|who|where|when|why|how)\b/i.test(question)) return false;
  return /^(?:is|are|was|do|does|did|have|has)\s+(?:it|this|that|you)\b/i.test(question);
}

/** Follow-ups are derived only from the latest real reply, never an older turn or a canned conversation. */
export function suggestionsFor(history: readonly Block[], running: boolean, pendingUser: boolean): string[] {
  if (running || pendingUser) return [];
  // After you stopped it, the one thing to offer is to carry on (the preview's "Say “carry on”…").
  const turnEnd = [...history].reverse().find((block) => block.kind === "user" || block.kind === "done");
  if (turnEnd?.kind === "done" && turnEnd.stopped) return ["Carry on"];
  const last = [...history].reverse().find((block) => block.kind === "user" || block.kind === "text");
  if (!last || last.kind !== "text") return [];
  const pending = pendingAskChips(history);
  if (pending) return pending;
  const words = last.text.trim();
  const lower = words.toLowerCase();
  const answer: string[] = [];
  const question = words.match(/[^.!?]*\?\s*$/)?.[0]?.trim();
  if (question && !/\bor\b/i.test(question)) {
    const offer = question.match(/^(?:want me to|shall i|should i|do you want me to)\s+(.+?)\?$/i);
    if (offer && / and /i.test(offer[1])) {
      const [a] = offer[1].split(/ and /i);
      answer.push(
        "Yes, do both",
        "Just " + a.replace(/^(put|add) it /i, "$1 it ").trim().replace(/^./, (x) => x.toLowerCase()),
        "Not now",
      );
    } else if (offer) answer.push("Yes, please", "Not now");
    else if (isConfirmation(question)) answer.push("Yes", "No");
  }
  if (/\$\d|short|late fee|difference/i.test(lower) && /invoice|paid/i.test(lower)) {
    answer.push("Ask them to waive it", "Show me the invoice");
  }
  if (/library|saved .*\.(md|pdf|xlsx)|\b\w+\.(xlsx|pdf|md)\b/i.test(words)) answer.push("Open it");
  if (/stopped|paused/i.test(lower)) answer.push("Carry on");
  if (words.length > 600) answer.push("Make it shorter");
  return [...new Set(answer)].slice(0, 3);
}
