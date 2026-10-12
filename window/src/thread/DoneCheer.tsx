// The done cheer (DESIGN-SPEC §4.2.5): when a Trunk's work ends, a card over the dock with that Trunk's face in
// its "yay" state, "<Trunk> is done" and the Done-in time. It rises in, starts to leave at 3.8 s and is gone at
// 4.3 s, and never takes clicks. Not shown in rooms (rule 3), and never for a run you stopped or one that failed
// (owner decision 8, 2026-10-06).
import { useEffect, useRef, useState } from "react";
import type { RunEnd } from "../connect/session";
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import { formatDuration } from "./format";
import type { Block } from "./model";
import { isInternalStep } from "./internal-steps";

const LEAVE_MS = 3800;
const GONE_MS = 4300;

/** Watches for a run that finished and returns it while the cheer shows. Its time is that run's own Done line,
 *  never an earlier run's. */
function useCheer(ended: RunEnd | null | undefined, history: readonly Block[]): { done: { durationMs?: number } | null; leaving: boolean } {
  const seen = useRef(ended);
  const [done, setDone] = useState<{ runId: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (ended && ended !== seen.current && ended.outcome === "done") {
      setDone({ runId: ended.runId });
      setLeaving(false);
    }
    seen.current = ended;
  }, [ended]);
  useEffect(() => {
    if (!done) return;
    const leave = setTimeout(() => setLeaving(true), LEAVE_MS);
    const gone = setTimeout(() => setDone(null), GONE_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, [done]);
  const at = done ? history.findIndex((b) => b.kind === "done" && b.runId === done.runId) : -1;
  const line = at >= 0 ? (history[at] as Extract<Block, { kind: "done" }>) : undefined;
  // The time only when the thread shows it too: a task's Done line (owner decision 5), never a plain reply's.
  let start = at;
  while (start > 0 && history[start - 1].kind !== "user") start -= 1;
  const task = at >= 0 && history.slice(start, at).some((b) => b.kind === "step" && !isInternalStep(b));
  return { done: done ? { durationMs: line && task && !line.stopped ? line.durationMs : undefined } : null, leaving };
}

export function DoneCheer({ name, ended, history, room = false }: { name: string; ended?: RunEnd | null; history: readonly Block[]; room?: boolean }) {
  const { done, leaving } = useCheer(ended, history);
  if (!done || room) return null;
  return (
    <div className={leaving ? "cheer leaving" : "cheer"} role="status" data-testid="done-cheer">
      <Face size={58} label={name} state="yay" priority={PRIORITY.open} />
      <span className="cheer-text">
        <b>{name} is done</b>
        <small>{done.durationMs ? `Done in ${formatDuration(done.durationMs)}` : "Finished. It’s in the conversation."}</small>
      </span>
    </div>
  );
}
