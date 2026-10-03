/** Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597
 * server/utils/chats/exportChatToFile.js thought-chain and plaintext export. */
import type { TranscriptEntry } from "./resume-transcript-entries.js";
const THOUGHT_TAGS = "thinking|think|thought|thought_chain";

export function stripThoughtChain(value = ""): string {
  return value.replace(new RegExp(`<(${THOUGHT_TAGS})[^>]*>[\\s\\S]*?</(${THOUGHT_TAGS})\\s*>`, "gi"), "")
    .replace(new RegExp(`</?(${THOUGHT_TAGS}|response|answer)[^>]*>`, "gi"), "").trim();
}

export function extractThoughtChain(value = ""): string | null {
  const matches: string[] = [];
  const pattern = new RegExp(`<(${THOUGHT_TAGS})[^>]*>([\\s\\S]*?)</(${THOUGHT_TAGS})\\s*>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) matches.push(match[2].trim());
  return matches.join("\n\n") || null;
}

export function entriesToPlainText(entries: readonly TranscriptEntry[], title: string): string {
  const lines = [`Thread: ${title}`, ""];
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    const content = entry.author === "assistant" ? stripThoughtChain(entry.content) : entry.content.trim();
    if (!content) continue;
    const label = entry.author === "user" ? "You" : "Assistant";
    lines.push("─".repeat(60), "", `[${label}]`, "", content, "");
  }
  return lines.join("\n");
}
