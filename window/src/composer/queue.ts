// The waiting line (DESIGN-SPEC §4.3.7): messages sent while the Trunk works, held on this computer and sent
// one at a time once the run ends, the way OpenClaw's browser UI keeps its outbox (ui/src/pages/chat/chat-queue.ts).
import { inputPrivacy } from "./drafts";
import { registerVolatileInput } from "../connect/update-barrier";
import type { Person } from "./DockRow";
import type { Reply } from "./sending";
import type { DraftFile } from "./attachments";

export type QueueState = "waiting" | "sending" | "failed";

export type QueueItem = {
  id: string;
  text: string;
  files: DraftFile[];
  sessionId?: string;
  awaitingReceipt?: boolean;
  cancelled?: boolean;
  people?: Person[];
  reply?: Reply | null;
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
const volatileLines = new Map<string, QueueItem[]>();
registerVolatileInput(() => [...volatileLines].some(([key, line]) => inputPrivacy(key) !== "ordinary" && line.length > 0));

/** The line kept on this computer, so it survives closing Branch (§4.3.7 "Messages written while offline"). */
export function loadLine(storage: Storage | undefined, sessionKey: string): QueueItem[] {
  const retained = volatileLines.get(sessionKey);
  if (retained) return retained;
  const raw = storage?.getItem(KEY + sessionKey);
  if (!raw) {
    return [];
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // A message that was going out when Branch closed waits again; nothing is sent twice by itself.
  return (parsed as QueueItem[]).map((item) => (item.state === "sending" ? { ...item, state: "failed", awaitingReceipt: true, error: "Delivery not confirmed" } : item));
}

export function saveLine(storage: Storage | undefined, sessionKey: string, line: readonly QueueItem[]): void {
  if (inputPrivacy(sessionKey) !== "ordinary") {
    volatileLines.set(sessionKey, [...line]);
    if (inputPrivacy(sessionKey) === "private") storage?.removeItem(KEY + sessionKey);
    return;
  }
  if (!storage) throw new Error("This computer cannot save waiting messages yet.");
  volatileLines.delete(sessionKey);
  if (line.length === 0) {
    storage.removeItem(KEY + sessionKey);
    return;
  }
  storage.setItem(KEY + sessionKey, JSON.stringify(line));
}

/** Receipts are scoped to the exact physical conversation that admitted this UUID. */
export function reconcileLine(line: readonly QueueItem[], history: unknown): QueueItem[] {
  const h = history && typeof history === "object" ? history as Record<string, unknown> : {};
  const info = h.sessionInfo && typeof h.sessionInfo === "object" ? h.sessionInfo as Record<string, unknown> : {};
  const sessionId = h.sessionId ?? info.sessionId;
  const receipts = Array.isArray(h.inputReceipts) ? h.inputReceipts as Array<Record<string, unknown>> : [];
  const consumed = Array.isArray(h.inputConsumptions) ? h.inputConsumptions as Array<Record<string, unknown>> : [];
  return line.flatMap((item) => {
    if (!item.awaitingReceipt) return [item];
    if (!item.sessionId || sessionId !== item.sessionId) return [{ ...item, state: "failed", error: "This conversation changed. Your waiting message is kept here." }];
    const receipt = receipts.find((r) => r.runId === item.id);
    if (receipt?.state === "consumed" || consumed.some((r) => r.runId === item.id)) return [];
    if (receipt?.cancelled === true) return [{ ...item, state: "failed", awaitingReceipt: false, cancelled: true, error: "Delivery was cancelled. Your message is kept here." }];
    if (receipt?.state === "pending") return [{ ...item, state: "sending", error: "Waiting for the conversation to finish receiving this message." }];
    return [{ ...item, state: "failed", error: "Delivery not confirmed. Your message is kept here while Branch checks the conversation." }];
  });
}
