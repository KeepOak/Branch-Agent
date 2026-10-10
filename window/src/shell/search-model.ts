// Sidebar search (DESIGN-SPEC §4.1.2): which results show for a query and how a match is cut and marked.
import type { Conversation } from "../connect/conversations";

export type SearchChip = "all" | "chats" | "messages" | "past" | "files";

export type MessageHit = { key: string; role: "user" | "assistant"; snippet: string; at: number; messageId: string };
export type FileHit = { title: string; snippet: string };

export type SearchResults = {
  chats: Conversation[];
  messages: MessageHit[];
  past: Conversation[];
  files: FileHit[];
};

/** The five chips, in order (§4.1.2 rule 2). */
export const CHIPS: { id: SearchChip; name: string; section: keyof SearchResults | null; label: string }[] = [
  { id: "all", name: "All", section: null, label: "" },
  { id: "chats", name: "Chats", section: "chats", label: "Chats and Trunks" },
  { id: "messages", name: "Messages", section: "messages", label: "Messages" },
  { id: "past", name: "Past", section: "past", label: "Past sessions" },
  { id: "files", name: "Files", section: "files", label: "Files and memory" },
];

const has = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase());

/** Conversations whose name or Trunk matches (case-insensitive substring); archived ones are "Past". */
export function matchConversations(rows: Conversation[], q: string, trunkName: (id: string | undefined) => string): { chats: Conversation[]; past: Conversation[] } {
  const query = q.trim();
  if (!query) {
    return { chats: [], past: [] };
  }
  const hit = rows.filter((r) => has(r.title || "", query) || has(trunkName(r.agentId), query) || has(r.preview, query));
  return { chats: hit.filter((r) => !r.archived), past: hit.filter((r) => r.archived) };
}

/** A message snippet as plain words: links and emphasis marks dropped, so the row never shows raw markdown. */
export function plainSnippet(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads sessions.search `results[]`, at most 25 (the most one message search returns). */
export function readMessageHits(result: unknown): MessageHit[] {
  const items = (result as { results?: unknown })?.results;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, 25).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      key: String(r.sessionKey ?? ""),
      role: r.role === "user" ? "user" : "assistant",
      snippet: plainSnippet(String(r.snippet ?? "")),
      at: typeof r.timestamp === "number" ? r.timestamp : 0,
      messageId: String(r.messageId ?? ""),
    };
  });
}

/** Reads memory.search `results[]` into file and memory hits. */
export function readFileHits(result: unknown): FileHit[] {
  const items = (result as { results?: unknown })?.results;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((raw) => {
    const r = raw as Record<string, unknown>;
    return { title: String(r.path ?? r.source ?? r.title ?? ""), snippet: String(r.snippet ?? r.text ?? "").replace(/\s+/g, " ").trim() };
  });
}

/** A snippet starts about 36 characters before the match, with "…" where it was cut (§4.1.2 Highlight). */
export function cutAround(text: string, q: string, before = 36): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i <= before) {
    return text;
  }
  return `…${text.slice(i - before)}`;
}

/** Splits text into plain and matched parts, for `<mark>`. */
export function markParts(text: string, q: string): { text: string; hit: boolean }[] {
  const query = q.trim();
  if (!query) {
    return [{ text, hit: false }];
  }
  const parts: { text: string; hit: boolean }[] = [];
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  let from = 0;
  for (let i = lower.indexOf(ql); i !== -1; i = lower.indexOf(ql, from)) {
    if (i > from) {
      parts.push({ text: text.slice(from, i), hit: false });
    }
    parts.push({ text: text.slice(i, i + query.length), hit: true });
    from = i + query.length;
  }
  if (from < text.length) {
    parts.push({ text: text.slice(from), hit: false });
  }
  return parts;
}

export function countOf(r: SearchResults, chip: SearchChip): number {
  return chip === "all" ? r.chats.length + r.messages.length + r.past.length + r.files.length : r[chip].length;
}
