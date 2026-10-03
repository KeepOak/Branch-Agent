// The done cheer (DESIGN-SPEC §4.2.5): when a Trunk's work ends, a card over the dock with that Trunk's face in
// its "yay" state, "<Trunk> is done" and the Done-in time. It rises in, starts to leave at 3.8 s and is gone at
// 4.3 s, and never takes clicks. Not shown in rooms (rule 3).
import { useEffect, useRef, useState } from "react";
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import { formatDuration } from "./format";
import type { Block } from "./model";

const LEAVE_MS = 3800;
const GONE_MS = 4300;

/** Watches the run end (running goes false) and returns the finished run's Done block while the cheer shows. */
function useCheer(running: boolean, history: readonly Block[]): { done: Extract<Block, { kind: "done" }> | null; leaving: boolean } {
  const was = useRef(running);
  const [done, setDone] = useState<Extract<Block, { kind: "done" }> | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (was.current && !running) {
      const last = [...history].reverse().find((b): b is Extract<Block, { kind: "done" }> => b.kind === "done") ?? null;
      setDone(last);
      setLeaving(false);
    }
    was.current = running;
  }, [running, history]);
  useEffect(() => {
    if (!done) return;
    const leave = setTimeout(() => setLeaving(true), LEAVE_MS);
    const gone = setTimeout(() => setDone(null), GONE_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, [done]);
  return { done, leaving };
}

export function DoneCheer({ name, running, history, room = false }: { name: string; running: boolean; history: readonly Block[]; room?: boolean }) {
  const { done, leaving } = useCheer(running, history);
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
