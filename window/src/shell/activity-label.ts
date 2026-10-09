// Shared row words for Overview › Recent activity and Control tower › Working now.
// The engine keeps the hourly poll prompt and `Name id:<chat-app-id>` session labels; these lists do not.

/** Friendly words for the engine's hourly heartbeat poll. */
export const ROUTINE_CHECK_IN = "Routine check-in";

/** Engine `formatInboundFromLabel` appends ` id:<chat-app-id>` after the display name. */
const CHAT_APP_ID = /\s+id:/i;

export function activityLabel(raw: string | undefined, fallback = ""): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (lower.includes("heartbeat poll") || lower.includes("heartbeat wake")) return ROUTINE_CHECK_IN;
  const at = text.search(CHAT_APP_ID);
  if (at > 0) return text.slice(0, at).trim() || fallback;
  if (/^id:\s*\S+/i.test(text)) return fallback;
  return text;
}

/** Title and supporting line for a Working now / Recent activity row. */
export function activityRowLines(title: string | undefined, ...details: (string | undefined)[]): { title: string; detail: string } {
  const shown = activityLabel(title);
  let detail = "";
  for (const part of details) {
    const next = activityLabel(part);
    if (next) {
      detail = next;
      break;
    }
  }
  if (detail && detail === shown) detail = "";
  return { title: shown, detail };
}
