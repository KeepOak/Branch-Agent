// Applies each editor change the moment it is made. Writes run one at a time, and each is diffed against the last draft
// the engine accepted, so two quick clicks never send a stale baseline. A refused write rolls the draft back and says why.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { applyTrunk, type Draft } from "./api";
import { changedFields, removals, type FieldKey, type Removal } from "./draft-fields";
import { errorText } from "./model";

export const SAVED_MS = 2000;
export const UNDO_MS = 5000;
type Timer = "saved" | "undo";

/** One pending timeout per key. Every timeout is cleared when the editor closes. */
function useTimers() {
  const timers = useRef<Partial<Record<Timer, ReturnType<typeof setTimeout>>>>({});
  useEffect(() => () => { clearTimeout(timers.current.saved); clearTimeout(timers.current.undo); }, []);
  const later = useCallback((key: Timer, ms: number, run: () => void) => { clearTimeout(timers.current[key]); timers.current[key] = setTimeout(run, ms); }, []);
  const cancel = useCallback((key: Timer) => clearTimeout(timers.current[key]), []);
  return { later, cancel };
}

export function useApply(engine: WindowEngine, agentId: string, initial: Draft, write: boolean) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState<ReadonlySet<FieldKey>>(new Set());
  const [undo, setUndo] = useState<Removal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef(initial), wanted = useRef(initial), touched = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const { later, cancel } = useTimers();

  const flush = useCallback(async () => {
    const target = wanted.current, was = confirmed.current;
    if (target === was) return;
    try {
      await applyTrunk(engine, agentId, was, target);
      confirmed.current = target; touched.current = true; setError(null);
      const fields = changedFields(was, target);
      if (fields.length) { setSaved(new Set(fields)); later("saved", SAVED_MS, () => setSaved(new Set())); }
    } catch (cause) {
      wanted.current = confirmed.current;
      setDraft(confirmed.current);
      setError(errorText(cause));
    }
  }, [engine, agentId, later]);

  const set = useCallback((d: Partial<Draft>) => {
    if (!write) return;
    const was = wanted.current, next: Draft = { ...was, ...d };
    wanted.current = next;
    setDraft(next);
    const [first] = removals(was, next);
    if (first) { setUndo(first); later("undo", UNDO_MS, () => setUndo(null)); }
    queue.current = queue.current.then(flush);
  }, [write, flush, later]);

  const undoLast = useCallback(() => {
    if (!undo) return;
    cancel("undo");
    setUndo(null);
    set(undo.revert(wanted.current));
  }, [undo, set, cancel]);

  /** Resolves once every queued write has settled, with whether any of them landed. */
  const settled = useCallback(async () => { await queue.current; return touched.current; }, []);

  return { draft, set, saved, undo, undoLast, error, settled };
}
