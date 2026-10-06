// The waiting line (DESIGN-SPEC §4.3.7): messages sent while the Trunk works, held on this computer and sent
// one at a time once the run ends, the way OpenClaw's browser UI keeps its outbox (ui/src/pages/chat/chat-queue.ts).
import type { DraftFile } from "./attachments";

export type QueueState = "waiting" | "sending" | "failed";

export type QueueItem = {
  id: string;
  text: string;
  files: DraftFile[];
  state: QueueState;
  error?: string;
};

export function enqueue(line: readonly QueueItem[], item: Omit<QueueItem, "state">): QueueItem[] {
  return [...line, { ...item, state: "waiting" }];
}

export function reword(line: readonly QueueItem[], id: string, text: string): QueueItem[] {
  return line.map((item) => (item.id === id ? { ...item, text } : item));
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
  if (line.some((item) => item.state === "sending" || item.state === "failed")) {
    return undefined;
  }
  return line.find((item) => item.state === "waiting");
}

/** The waiting-line chip's words. */
export function chipWords(count: number, offline: boolean): string {
  return offline ? `${count} waiting · Offline` : `${count} waiting`;
}

const KEY = "branch.composer.queue:";

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
