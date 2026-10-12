// The waiting line's state: kept per conversation on this computer, and drained one message at a time when the
// Trunk is free (DESIGN-SPEC §4.3.7). Sending goes through the window's own send (chat.send).
import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftFile } from "./attachments";
import { safeStorage } from "./drafts";
import type { SkillPick } from "./skill-picks";
import { enqueue, loadLine, moveUp, nextToSend, onLineChange, remove, reword, saveLine, type QueueItem } from "./queue";

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
    if (!sessionKey) return;
    // Others write this line too: the session keeps a message that wasn't sent or confirmed here, the thread's Try
    // again and Discard change it, and so does another window of this computer. Follow them so the line drains (or
    // stays paused) the same as when the composer writes.
    return onLineChange(sessionKey, () => {
      queueMicrotask(() => {
        const next = readStored(sessionKey).line;
        setLine((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    });
  }, [sessionKey]);

  const update = useCallback(
    (fn: (line: QueueItem[]) => QueueItem[]) => {
      const storage = safeStorage();
      if (!sessionKey || !storage) {
        setLine((current) => fn(current));
        return;
      }
      // Read, change and write the stored line, never this window's copy of it: the copy can miss a record another
      // window (or the session) just wrote, and writing it back would drop that record.
      let next: QueueItem[];
      try {
        next = fn(loadLine(storage, sessionKey));
      } catch (e) {
        setError(`The saved waiting line couldn't be read: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      try {
        saveLine(storage, sessionKey, next);
      } catch (e) {
        setError(`This computer's storage for waiting messages is full. Send or remove some first. (${e instanceof Error ? e.message : String(e)})`);
      }
      setLine(next);
    },
    [sessionKey],
  );

  // When the Trunk is free and Branch is connected, the first waiting message goes.
  useEffect(() => {
    if (working || offline) return;
    // What is stored decides, not this window's copy: another window may have just added a record that holds the line.
    const item = nextToSend(sessionKey && safeStorage() ? readStored(sessionKey).line : line);
    if (!item) return;
    update((l) => remove(l, item.id));
    deliverRef.current(item, false);
  }, [line, working, offline, update, sessionKey]);

  const add = useCallback(
    (text: string, files: DraftFile[], picks: SkillPick[] = []) => update((l) => enqueue(l, { id: crypto.randomUUID(), text, files, picks, createdAt: Date.now() })),
    [update],
  );
  const steerNow = useCallback(
    (id: string) => {
      const item = line.find((i) => i.id === id);
      if (!item) return;
      update((l) => remove(l, id));
      deliverRef.current(item, true);
    },
    [line, update],
  );
  return {
    line,
    error,
    add,
    steerNow,
    reword: (id: string, text: string) => update((l) => reword(l, id, text)),
    moveUp: (id: string) => update((l) => moveUp(l, id)),
    remove: (id: string) => update((l) => remove(l, id)),
    retry: (id: string) => update((l) => l.map((item) => item.id === id ? { ...item, id: crypto.randomUUID(), state: "waiting", error: undefined, sentTo: undefined, sentWith: undefined } : item)),
  };
}
