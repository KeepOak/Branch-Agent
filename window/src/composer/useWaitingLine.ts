// The waiting line's state: kept per conversation on this computer, and drained one message at a time when the
// Trunk is free (DESIGN-SPEC §4.3.7). Sending goes through the window's own send (chat.send).
import { useCallback, useEffect, useRef, useState } from "react";
import { registerInputCheckpoint, updateBlocked, useUpdateBarrier } from "../connect/update-barrier";
import type { DraftFile } from "./attachments";
import { safeStorage } from "./drafts";
import { enqueue, loadLine, moveUp, nextToSend, remove, reword, saveLine, mark, reconcileLine, type QueueItem } from "./queue";

export type Deliver = (item: QueueItem, steer: boolean) => Promise<void>;

function readStored(sessionKey: string | null): { line: QueueItem[]; error: string | null } {
  if (!sessionKey) return { line: [], error: null };
  try {
    return { line: loadLine(safeStorage(), sessionKey), error: null };
  } catch (error) {
    return { line: [], error: `The saved waiting line couldn't be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function useWaitingLine(sessionKey: string | null, working: boolean, offline: boolean, deliver: Deliver, custody?: { sessionId: string; read: (ids: string[]) => Promise<unknown> }) {
  const [line, setLine] = useState<QueueItem[]>(() => readStored(sessionKey).line);
  const [error, setError] = useState<string | null>(() => readStored(sessionKey).error);
  const blocked = useUpdateBarrier();
  const custodyRef = useRef(custody);
  custodyRef.current = custody;
  const reconciling = useRef(false);
  const active = useRef(new Set<string>());
  const pending = useRef(new Set<Promise<void>>());
  const currentKey = useRef(sessionKey);
  currentKey.current = sessionKey;
  const lineRef = useRef(line);
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  useEffect(() => {
    const stored = readStored(sessionKey);
    lineRef.current = stored.line;
    setLine(stored.line);
    setError(stored.error);
  }, [sessionKey]);

  const update = useCallback(
    (fn: (line: QueueItem[]) => QueueItem[]) => {
      const next = fn(lineRef.current);
      try { if (sessionKey) saveLine(safeStorage(), sessionKey, next); }
      catch { setError("Waiting messages couldn't be saved. Branch will keep your draft here."); return false; }
      lineRef.current = next;
      setLine(next);
      return true;
    },
    [sessionKey],
  );

  useEffect(() => registerInputCheckpoint(async () => {
    await Promise.all([...pending.current]);
    if (currentKey.current) saveLine(safeStorage(), currentKey.current, lineRef.current);
  }), []);

  const send = useCallback((item: QueueItem, steer: boolean) => {
    if (!sessionKey || updateBlocked() || active.current.has(item.id) || item.awaitingReceipt) return;
    // Persist the sending state BEFORE admission. It remains recoverable until the ACK lands.
    const pinned = lineRef.current.map((i) => i.id === item.id ? { ...i, sessionId: i.sessionId ?? custodyRef.current?.sessionId } : i);
    const deliveryItem = pinned.find((i) => i.id === item.id)!;
    if (custodyRef.current && (!deliveryItem.sessionId || deliveryItem.sessionId !== custodyRef.current.sessionId)) { setError("This conversation changed. Your waiting message is kept here."); return; }
    const stored = mark(pinned, item.id, "sending").map((i) => i.id === item.id ? { ...i, awaitingReceipt: true } : i);
    try { saveLine(safeStorage(), sessionKey, stored); }
    catch { setError("Waiting messages couldn't be saved. Branch will keep them here."); return; }
    active.current.add(item.id);
    lineRef.current = stored;
    setLine(stored);
    const deliver = deliverRef.current;
    const job = Promise.resolve().then(() => deliver(deliveryItem, steer)).then(() => {
      const current = currentKey.current === sessionKey ? lineRef.current : loadLine(safeStorage(), sessionKey);
      const next = remove(current, item.id);
      saveLine(safeStorage(), sessionKey, next);
      if (currentKey.current === sessionKey) { lineRef.current = next; setLine(next); }
    }, (reason: unknown) => {
      const current = currentKey.current === sessionKey ? lineRef.current : loadLine(safeStorage(), sessionKey);
      const next = mark(current, item.id, "failed", reason instanceof Error ? reason.message : "Delivery not confirmed");
      saveLine(safeStorage(), sessionKey, next);
      if (currentKey.current === sessionKey) { lineRef.current = next; setLine(next); }
    }).catch(() => { setError("Delivery couldn't be saved. The message is still waiting for confirmation."); }).finally(() => { active.current.delete(item.id); pending.current.delete(job); });
    pending.current.add(job);
  }, [sessionKey]);

  const reconcile = useCallback(async () => {
    const read = custodyRef.current?.read;
    const ids = lineRef.current.filter((i) => i.awaitingReceipt && !active.current.has(i.id)).map((i) => i.id);
    if (!read || !sessionKey || offline || updateBlocked() || reconciling.current || !ids.length) return;
    reconciling.current = true;
    try {
      const history = await read(ids);
      if (currentKey.current === sessionKey) update((l) => reconcileLine(l, history));
    } catch { setError("Branch couldn't confirm delivery yet. Your waiting messages are kept here."); }
    finally { reconciling.current = false; }
  }, [sessionKey, offline, update]);
  useEffect(() => { if (!offline && !blocked) void reconcile(); }, [sessionKey, offline, blocked, reconcile]);

  useEffect(() => {
    if (working || offline || blocked) return;
    const item = nextToSend(line);
    if (item) send(item, false);
  }, [line, working, offline, blocked, send]);

  const add = useCallback((text: string, files: DraftFile[], extras?: Pick<QueueItem, "people" | "reply">) => update((l) => enqueue(l, { id: crypto.randomUUID(), text, files, sessionId: custodyRef.current?.sessionId, ...extras })), [update]);
  const steerNow = useCallback(
    (id: string) => {
      const item = line.find((i) => i.id === id);
      if (!item || offline || item.state === "sending") return;
      send(item, true);
    },
    [line, offline, send],
  );
  return {
    line,
    error,
    add,
    steerNow,
    reword: (id: string, text: string) => update((l) => l.find((i) => i.id === id)?.awaitingReceipt ? l : reword(l, id, text)),
    moveUp: (id: string) => update((l) => moveUp(l, id)),
    remove: (id: string) => {
      if (lineRef.current.find((i) => i.id === id)?.awaitingReceipt) { setError("Delivery is not confirmed yet. Branch will keep the message until the conversation confirms it."); return; }
      update((l) => remove(l, id));
    },
    reconcile,
    retry: (id: string) => {
      if (lineRef.current.find((i) => i.id === id)?.awaitingReceipt) void reconcile();
      else update((l) => l.map((i) => i.id === id ? { ...i, id: i.cancelled ? crypto.randomUUID() : i.id, state: "waiting", cancelled: false, error: undefined } : i));
    },
  };
}
