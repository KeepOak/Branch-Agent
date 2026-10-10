// Apply-on-change helpers for Grafts and Saved sign-ins. A change saves as soon as it is made and shows a "Saved" tick.
// A destructive change waits five seconds first, and Undo cancels it before the engine hears about it.
import { useEffect, useRef, useState } from "react";
import { Btn } from "../kit";

export const UNDO_MS = 5000;
const TICK_MS = 2000;

/** A "Saved" tick that shows for two seconds after `mark()`. */
export function useSavedTick(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mark = () => {
    window.clearTimeout(timer.current);
    setOn(true);
    timer.current = window.setTimeout(() => setOn(false), TICK_MS);
  };
  return [on, mark];
}

export type Pending = { key: string; label: string };

/** A destructive change for one item (by key) waits UNDO_MS before `commit` runs; `undo` cancels it. */
export function useDelayedChange() {
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const undo = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setPending(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = (key: string, label: string, commit: () => void) => {
    undo();
    setPending({ key, label });
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setPending(null);
      commit();
    }, UNDO_MS);
  };
  return { pending, start, undo };
}

/** The line under a row while a change waits: its label and Undo. */
export function UndoLine({ label, onUndo }: { label: string; onUndo: () => void }) {
  return <p className="hint" role="status">{label}. <Btn sm ghost onClick={onUndo}>Undo</Btn></p>;
}
