// Talking to the default Trunk beside a place or Settings page (DESIGN-SPEC §3.3, the preview's askPA18 pane): the
// default Trunk's main conversation, sent with the page as work context. The engine takes that context on chat.send
// as `workContext` and keeps it on the user message as __branch.workContext.snapshot (engine src/chat/work-context.ts),
// the way its own Home dock sends it (engine ui/src/pages/chat/chat-work-context.ts buildHomeWorkContext).
import { historyToBlocks } from "../thread/history";

/** The engine's bounds for the fields sent here (engine packages/gateway-protocol/src/chat-work-context.ts). */
const LIMITS = { page: 64, selection: 640 } as const;
/** How many messages the pane shows, as the preview's (its last 30). */
const SHOWN = 30;

export type WorkContext = { page: string; selection?: string };
export type TalkRow =
  | { kind: "you"; key: string; text: string; context?: [string, string][] }
  | { kind: "trunk"; key: string; text: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Cuts to `max` UTF-16 units without leaving half a surrogate pair. */
function clip(text: string, max: number): string {
  const cut = text.trim().slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** The context a send carries: the page's name, and the selected text when the person attached it. */
export function workContextFor(page: string, selection: string): WorkContext | undefined {
  const name = clip(page, LIMITS.page);
  if (!name) {
    return undefined; // the engine requires a page name
  }
  const picked = clip(selection, LIMITS.selection);
  return picked ? { page: name, selection: picked } : { page: name };
}

const LABELS: Record<string, string> = { page: "Page", title: "Title", selection: "Selected text", file: "File", workspace: "Folder" };

/** What a user message says it was sent with, as label and value pairs (engine readMessageWorkContext). */
export function contextOf(message: unknown): [string, string][] | undefined {
  const snapshot = rec(rec(rec(rec(message).__branch).workContext).snapshot);
  if (typeof snapshot.page !== "string" || !snapshot.page) {
    return undefined;
  }
  return Object.entries(snapshot)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] in LABELS)
    .map(([key, value]) => [LABELS[key] ?? key, value]);
}

/** The pane's rows from chat.history: what the person said (with its context) and what the Trunk answered. */
export function talkRows(messages: readonly unknown[], sessionKey: string): TalkRow[] {
  return historyToBlocks(messages, [], sessionKey, null)
    .flatMap((b): TalkRow[] => {
      if (b.kind === "user" && b.text.trim()) {
        const context = contextOf(messages[Number(b.key.slice(2))]);
        return [{ kind: "you", key: b.key, text: b.text, ...(context ? { context } : {}) }];
      }
      return b.kind === "text" && b.text.trim() ? [{ kind: "trunk", key: b.key, text: b.text }] : [];
    })
    .slice(-SHOWN);
}
