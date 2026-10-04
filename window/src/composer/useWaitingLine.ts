// The waiting line's state: kept per conversation on this computer, and drained one message at a time when the
// Trunk is free (DESIGN-SPEC §4.3.7). Sending goes through the window's own send (chat.send).
import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftFile } from "./attachments";
import { safeStorage } from "./drafts";
import { enqueue, loadLine, moveUp, nextToSend, remove, reword, saveLine, mark, type QueueItem } from "./queue";

export type Deliver = (item: QueueItem, steer: boolean) => void;

function readStored(sessionKey: string | null): { line: QueueItem[]; error: string | null } {
  if (!sessionKey) return { line: [], error: null };
  try {
    return { line: loadLine(safeStorage(), sessionKey), error: null };
  } catch (error) {
    return { line: [], error: `The saved waiting line couldn't be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function useWaitingLine(sessionKey: string | null, working: boolean, offline: boolean, deliver: Deliver) {
  const [line, setLine] = useState<QueueItem[]>(() => readStored(sessionKey).line);
  const [error, setError] = useState<string | null>(() => readStored(sessionKey).error);
  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  useEffect(() => {
    const stored = readStored(sessionKey);
    setLine(stored.line);
    setError(stored.error);
  }, [sessionKey]);

  const update = useCallback(
    (fn: (line: QueueItem[]) => QueueItem[]) => {
      setLine((current) => {
        const next = fn(current);
        if (sessionKey) {
          try {
            saveLine(safeStorage(), sessionKey, next);
          } catch (e) {
            setError(`This computer's storage for waiting messages is full. Send or remove some first. (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        return next;
      });
    },
    [sessionKey],
  );

  // When the Trunk is free and Branch is connected, the first waiting message goes.
  useEffect(() => {
    if (working || offline) return;
    const item = nextToSend(line);
    if (!item) return;
    update((l) => remove(l, item.id));
    deliverRef.current(item, false);
  }, [line, working, offline, update]);

  const add = useCallback((text: string, files: DraftFile[]) => update((l) => enqueue(l, { id: crypto.randomUUID(), text, files })), [update]);
  const steerNow = useCallback(
    (id: string) => {
      if (offline) return;
      const item = line.find((i) => i.id === id);
      if (!item) return;
      update((l) => remove(l, id));
      deliverRef.current(item, true);
    },
    [line, offline, update],
  );
  return {
    line,
    error,
    add,
    steerNow,
    reword: (id: string, text: string) => update((l) => reword(l, id, text)),
    moveUp: (id: string) => update((l) => moveUp(l, id)),
    remove: (id: string) => update((l) => remove(l, id)),
    retry: (id: string) => update((l) => mark(l, id, "waiting")),
  };
}
