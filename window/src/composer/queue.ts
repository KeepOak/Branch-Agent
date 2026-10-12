// The waiting line (DESIGN-SPEC §4.3.7): messages sent while the Trunk works, held on this computer and sent
// one at a time once the run ends, the way OpenClaw's browser UI keeps its outbox (ui/src/pages/chat/chat-queue.ts).
import type { DraftFile } from "./attachments";
import { reconcilePicks, type SkillPick } from "./skill-picks";

/** `checking`: sent, but the connection went before Branch confirmed it ("Not confirmed yet"). The engine may hold
 *  it: it is checked against its conversation and sent again under the same id only if the engine doesn't. */
export type QueueState = "waiting" | "sending" | "failed" | "checking";

/** What a checking message was sent with, so it goes again as it went. Its files are not kept on this computer, only
 *  how many there were (`attachments`): after a reload such a message is Not sent rather than sent without them. */
export type SentWith = { queueMode?: string; mentions?: unknown[]; replyToId?: string; attachments?: number };

/** Where and when a checking message went, so it is only ever checked or sent again on that engine, and only when a
 *  read of its conversation reaches back past it. `engine`: the engine it went to (connect/unconfirmed.ts
 *  engineKeyOf). `at`: when it was sent. `anchor`: the newest entry its conversation showed before it was sent (a read
 *  that holds this entry holds everything after it). `existed`: whether its conversation existed then. `owner`: the
 *  window that sent it (it alone keeps the files). */
export type SentTo = { engine: string; at: number; anchor?: string; existed: boolean; owner: string };

export type QueueItem = {
  id: string;
  text: string;
  files: DraftFile[];
  /** Where the skill picks sit in `text` (display text, /seedbank). Resolved when the message is sent. */
  picks?: SkillPick[];
  state: QueueState;
  error?: string;
  createdAt?: number;
  sentWith?: SentWith;
  sentTo?: SentTo;
};

export function enqueue(line: readonly QueueItem[], item: Omit<QueueItem, "state">): QueueItem[] {
  return [...line, { ...item, state: "waiting" }];
}

export function reword(line: readonly QueueItem[], id: string, text: string): QueueItem[] {
  return line.map((item) => (item.id === id ? { ...item, text, picks: reconcilePicks(item.picks ?? [], item.text, text) } : item));
}

export function moveUp(line: readonly QueueItem[], id: string): QueueItem[] {
  const at = line.findIndex((item) => item.id === id);
  if (at <= 0) {
    return [...line];
  }
  const next = [...line];
  [next[at - 1], next[at]] = [next[at], next[at - 1]];
  return next;
}

export function remove(line: readonly QueueItem[], id: string): QueueItem[] {
  return line.filter((item) => item.id !== id);
}

export function mark(line: readonly QueueItem[], id: string, state: QueueState, error?: string): QueueItem[] {
  return line.map((item) => (item.id === id ? { ...item, state, ...(error ? { error } : { error: undefined }) } : item));
}

/** The next message to send when the Trunk is free: the first waiting one, unless one is already going or failed. */
export function nextToSend(line: readonly QueueItem[]): QueueItem | undefined {
  if (line.some((item) => item.state === "sending" || item.state === "failed" || item.state === "checking")) {
    return undefined;
  }
  return line.find((item) => item.state === "waiting");
}

/** The waiting-line chip's words. */
export function chipWords(count: number, offline: boolean): string {
  return offline ? `${count} waiting · Offline` : `${count} waiting`;
}

const KEY = "branch.composer.queue:";

/** Calls `change` whenever this conversation's line changes: in this window (WAITING_LINE_EVENT) or in another window
 *  of this computer (the browser's storage event), so no window writes back a copy that misses another's change. */
export function onLineChange(sessionKey: string, change: () => void): () => void {
  const local = (event: Event) => {
    if ((event as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey === sessionKey) change();
  };
  const other = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY + sessionKey) change();
  };
  window.addEventListener(WAITING_LINE_EVENT, local);
  window.addEventListener("storage", other);
  return () => {
    window.removeEventListener(WAITING_LINE_EVENT, local);
    window.removeEventListener("storage", other);
  };
}

/** The line kept on this computer, so it survives closing Branch (§4.3.7 "Messages written while offline"). */
export function loadLine(storage: Storage | undefined, sessionKey: string): QueueItem[] {
  const raw = storage?.getItem(KEY + sessionKey);
  if (!raw) {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // A message that was going out when Branch closed waits again; nothing is sent twice by itself.
  return (parsed as QueueItem[]).map((item) => (item.state === "sending" ? { ...item, state: "failed", error: "Delivery not confirmed" } : item));
}

/** Fired on the window after the waiting line of a conversation changes, so the thread shows it as queued. */
export const WAITING_LINE_EVENT = "branch:waiting-line";

function announce(sessionKey: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WAITING_LINE_EVENT, { detail: { sessionKey } }));
}

export function saveLine(storage: Storage | undefined, sessionKey: string, line: readonly QueueItem[]): void {
  if (!storage) {
    return;
  }
  if (line.length === 0) {
    storage.removeItem(KEY + sessionKey);
    announce(sessionKey);
    return;
  }
  storage.setItem(KEY + sessionKey, JSON.stringify(line));
  announce(sessionKey);
}

/**
 * "Not sent" (§4.2.2 Parity adds) lives in this same line, as an item in state "failed" with the reason in `error`:
 * one record on this computer that the thread (Try again, Discard) and Inbox read. A failed item pauses the line
 * until it is retried (`mark(..., "waiting")`, sent when the Trunk is free) or removed.
 */
export function addNotSent(storage: Storage | undefined, sessionKey: string, item: { id: string; text: string; error: string }): void {
  const line = loadLine(storage, sessionKey);
  if (line.some((queued) => queued.id === item.id)) return;
  saveLine(storage, sessionKey, [{ id: item.id, text: item.text, files: [], state: "failed", error: item.error }, ...line]);
}

/** A message sent but not confirmed (the connection went first): kept here so a reload never loses it. */
export function addChecking(storage: Storage | undefined, sessionKey: string, item: { id: string; text: string; sentWith: SentWith; sentTo: SentTo }): void {
  const line = loadLine(storage, sessionKey);
  if (line.some((queued) => queued.id === item.id)) return;
  saveLine(storage, sessionKey, [{ id: item.id, text: item.text, files: [], state: "checking", sentWith: item.sentWith, sentTo: item.sentTo }, ...line]);
}

/** Changes one item of a conversation's line (settling a checking message: gone, or Not sent). */
export function updateLine(storage: Storage | undefined, sessionKey: string, change: (line: QueueItem[]) => QueueItem[]): void {
  saveLine(storage, sessionKey, change(loadLine(storage, sessionKey)));
}

/** Every conversation's messages in `state` on this computer. */
export function itemsEverywhere(storage: Storage | undefined, state: QueueState): { sessionKey: string; item: QueueItem }[] {
  if (!storage) return [];
  const out: { sessionKey: string; item: QueueItem }[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(KEY)) continue;
    const sessionKey = key.slice(KEY.length);
    try {
      for (const item of loadLine(storage, sessionKey)) if (item.state === state) out.push({ sessionKey, item });
    } catch {
      // A line this browser can't read is left alone; the conversation reports it.
    }
  }
  return out;
}

/** Every conversation's "Not sent" messages on this computer, for Inbox. */
export function notSentEverywhere(storage: Storage | undefined): { sessionKey: string; item: QueueItem }[] {
  return itemsEverywhere(storage, "failed");
}

/** A "Not sent" or "Not confirmed yet" message the engine turns out to hold (`keptIds`: run ids a read of this
 *  conversation showed in its history, input receipts, waiting inputs or running turn) goes, so it is never sent
 *  twice. */
export function healNotSent(storage: Storage | undefined, sessionKey: string, keptIds: readonly string[]): void {
  if (!keptIds.length) return;
  const line = loadLine(storage, sessionKey);
  const kept = new Set(keptIds);
  const settled = (item: QueueItem) => (item.state === "failed" || item.state === "checking") && kept.has(item.id);
  if (line.some(settled)) saveLine(storage, sessionKey, line.filter((item) => !settled(item)));
}
