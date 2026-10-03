// Drafts kept per conversation (DESIGN-SPEC §4.3.1 rule 4) and earlier messages with Up and Down
// (§4.3.1 Parity adds, row composer-input-history; OpenClaw ui/src/pages/chat/input-history.ts).
import { registerInputCheckpoint } from "../connect/update-barrier";
import type { DraftFile } from "./attachments";
import type { Person } from "./DockRow";

export type DraftSnapshot = { text: string; files: DraftFile[]; people: Person[] };
const SNAPSHOT_KEY = "branch.composer.input:";
const DRAFT_KEY = "branch.composer.draft:";
const unsaved = new Map<string, DraftSnapshot>();
registerInputCheckpoint(() => {
  for (const [key, draft] of unsaved) saveDraftSnapshot(safeStorage(), key, draft);
});

/** The browser's storage for this window, or undefined where the browser refuses it (private mode, blocked data). */
export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch (error) {
    console.warn("Drafts stay in memory only: this browser refused local storage.", error);
    return undefined;
  }
}

export function loadDraft(storage: Storage | undefined, sessionKey: string): string {
  return loadDraftSnapshot(storage, sessionKey).text;
}

export function loadDraftSnapshot(storage: Storage | undefined, sessionKey: string): DraftSnapshot {
  const retained = unsaved.get(sessionKey);
  if (retained) return retained;
  const raw = storage?.getItem(SNAPSHOT_KEY + sessionKey);
  if (raw) {
    const parsed = JSON.parse(raw) as DraftSnapshot;
    if (typeof parsed.text !== "string" || !Array.isArray(parsed.files) || !Array.isArray(parsed.people)) throw new Error("Saved draft is incomplete.");
    const legacy = storage?.getItem(DRAFT_KEY + sessionKey);
    return legacy === null || legacy === undefined ? parsed : { ...parsed, text: legacy };
  }
  return { text: storage?.getItem(DRAFT_KEY + sessionKey) ?? "", files: [], people: [] };
}

export function saveDraftSnapshot(storage: Storage | undefined, sessionKey: string, draft: DraftSnapshot): void {
  unsaved.set(sessionKey, draft);
  if (!storage) throw new Error("This computer cannot save the draft yet.");
  if (draft.text || draft.files.length || draft.people.length) storage.setItem(SNAPSHOT_KEY + sessionKey, JSON.stringify(draft));
  else storage.removeItem(SNAPSHOT_KEY + sessionKey);
  // Retain the original text key so a retained older window can still reopen the words.
  if (draft.text || draft.files.length || draft.people.length) storage.setItem(DRAFT_KEY + sessionKey, draft.text);
  else storage.removeItem(DRAFT_KEY + sessionKey);
  unsaved.delete(sessionKey);
}

export function saveDraft(storage: Storage | undefined, sessionKey: string, text: string): void {
  if (!storage) return;
  saveDraftSnapshot(storage, sessionKey, { ...loadDraftSnapshot(storage, sessionKey), text });
}

/** Up to this many earlier messages per conversation (OpenClaw CHAT_INPUT_HISTORY_LIMIT). */
export const INPUT_HISTORY_LIMIT = 100;

/** Your own earlier messages in this conversation, newest first, without repeats (chat.history user rows). */
export function userTexts(messages: readonly unknown[]): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < INPUT_HISTORY_LIMIT; i -= 1) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m?.role !== "user") {
      continue;
    }
    const text = messageText(m.content).trim();
    if (text && !out.includes(text)) {
      out.push(text);
    }
  }
  return out;
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("");
}

export type HistoryWalk = { items: string[]; index: number; saved: string };

/** One step of Up (-1 is older) or Down through `walk`; returns the new walk and the text to show, or null at the end. */
export function step(walk: HistoryWalk, dir: "up" | "down"): { walk: HistoryWalk; text: string } | null {
  if (dir === "up") {
    if (walk.index + 1 >= walk.items.length) {
      return null;
    }
    const index = walk.index + 1;
    return { walk: { ...walk, index }, text: walk.items[index] };
  }
  if (walk.index < 0) {
    return null;
  }
  const index = walk.index - 1;
  return { walk: { ...walk, index }, text: index < 0 ? walk.saved : walk.items[index] };
}

/** Up works with the caret on the first line; Down with it on the last. */
export function caretOnEdge(text: string, caret: number, dir: "up" | "down"): boolean {
  return dir === "up" ? !text.slice(0, caret).includes("\n") : !text.slice(caret).includes("\n");
}
