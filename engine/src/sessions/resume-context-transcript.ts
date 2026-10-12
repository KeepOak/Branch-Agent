/** Kilo-Org/kilocode@6fd9b7b29ce63b5a38176e45b738e94ed6167cfb
 * packages/opencode/src/kilocode/session/transcript.ts format(): adapted native entries. */
import type { TranscriptEntry } from "./resume-transcript-entries.js";

export function formatContextTranscript(title: string, entries: readonly TranscriptEntry[],
  options: { max?: number } = {}): string {
  const lines: string[] = [`# Session: ${title}`, ""];
  for (const entry of entries) {
    if (entry.kind === "message") {
      lines.push(entry.author === "user" ? "## User" : "## Assistant", entry.content, "");
    }
    if (entry.kind === "tool") lines.push(`[Tool: ${entry.summary}]`, "");
  }
  const content = lines.join("\n");
  const max = options.max ?? 100_000;
  if (!Number.isSafeInteger(max) || max <= 0) throw new Error("Context size must be a positive integer");
  if (content.length <= max) return content;
  const head = Math.floor(max / 3);
  const tail = max - head;
  return `${content.slice(0, head)}\n\n[... ${content.length - max} characters omitted from the middle of this transcript ...]\n\n${content.slice(content.length - tail)}`;
}
