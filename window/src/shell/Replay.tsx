// "Replay this conversation" (the preview's replayDlgR118): the conversation's messages, one at a time, with Play and
// Pause, a slider for where it is, and 1×, 2× or 4×. It plays back what the engine already holds (chat.history).
import { useEffect, useState } from "react";
import type { Block } from "../thread/model";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";

type Line = { who: string; text: string };

/** The replay's lines: what you wrote and what the Trunk answered, in order. */
export function replayLines(history: Block[], trunkName: string): Line[] {
  return history.flatMap((b): Line[] =>
    (b.kind === "user" || b.kind === "text") && b.text.trim() ? [{ who: b.kind === "user" ? "You" : trunkName, text: b.text.trim() }] : [],
  );
}

const STEP_MS = 1600;

export function ReplayDialog({ history, trunkName, onClose }: { history: Block[]; trunkName: string; onClose: () => void }) {
  const lines = replayLines(history, trunkName);
  const n = lines.length;
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    if (at >= n - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setAt((i) => i + 1), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, at, n, speed]);
  const line = lines[Math.min(at, n - 1)];
  const toggle = () => {
    if (!playing && at >= n - 1) setAt(0);
    setPlaying(!playing);
  };
  return (
    <Dialog title="Replay this conversation" wide onClose={onClose} testid="replay" footer={<button type="button" className="btn primary" onClick={onClose}>Close</button>}>
      <div className="rp">
        <div className="rpc">
          <b>{line?.who ?? ""}</b>
          <p>{line ? line.text.slice(0, 400) : "Nothing to replay."}</p>
        </div>
        <div className="rp-acts">
          <button type="button" className="ib" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} disabled={!n} onClick={toggle}>
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <input type="range" min={0} max={Math.max(0, n - 1)} value={Math.min(at, Math.max(0, n - 1))} aria-label="Where in the conversation" disabled={!n}
            onChange={(e) => (setPlaying(false), setAt(Number(e.target.value)))} />
          <span className="hint">{Math.min(at + 1, n)} of {n}</span>
          <span className="seg" role="group" aria-label="Speed">
            {[1, 2, 4].map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
            ))}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
