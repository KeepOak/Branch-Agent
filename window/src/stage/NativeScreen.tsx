import { type CSSProperties, useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { type ComputerStatus, computerStatusProblem, type StatusProblem } from "./computer-status-problem";

type Status = ComputerStatus & { computerUse?: { provider: { generation: string } } };
type Frame = { format: "png" | "jpeg"; base64: string };
const SNAPSHOT_FAILED: StatusProblem = {
  line: "Couldn't show this computer's screen. Check that screen access is on, then try again.",
  retry: true,
};

/** One centered line with at most one action, in the pane's own box. Technical detail sits behind a disclosure. */
function PaneNote({ state, problem, onRetry }: { state: string; problem: StatusProblem | null; onRetry: () => void }) {
  return <div className="stage-empty pane-note" data-pane-state={state}>
    <p>{problem ? problem.line : "Connecting…"}</p>
    {problem?.retry ? <button type="button" className="btn" onClick={onRetry}>Try again</button> : null}
    {problem?.technical ? <details className="pane-technical"><summary>Technical details</summary><code>{problem.technical}</code></details> : null}
  </div>;
}

/** Native screen access uses the screen-and-mouse switch, not the separate VNC desktop setting.
 * Each capture releases its own execution immediately; opening this panel never keeps the computer occupied. */
export function NativeScreen({ engine, retry, onLive, onRetry }: { engine: WindowEngine; retry: number; onLive: (live: boolean) => void; onRetry: () => void }) {
  const [image, setImage] = useState("");
  const [problem, setProblem] = useState<StatusProblem | null>(null);
  // Width over height of the live frame, so the frame fills the pane width with no letterbox bands.
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setImage("");
    setProblem(null);
    onLive(false);
    const capture = async () => {
      let generation: string | undefined;
      const executionId = crypto.randomUUID();
      try {
        const status = await engine.request<Status>("computer.status", {});
        if (!live) return;
        const stopped = computerStatusProblem(status);
        if (stopped) {
          setImage("");
          setProblem(stopped);
          onLive(false);
          return;
        }
        setProblem(null);
        generation = status.computerUse?.provider.generation;
        if (!status.available || !generation) throw new Error("Screen unavailable");
        const result = await engine.request<{ payload: Frame }>("computer.invoke", {
          command: "screen.snapshot", generation, idempotencyKey: crypto.randomUUID(),
          params: { executionId },
        });
        const frame = result.payload;
        if (!frame.base64 || (frame.format !== "jpeg" && frame.format !== "png")) throw new Error("No screen image");
        if (live) {
          setImage(`data:image/${frame.format};base64,${frame.base64}`);
          setProblem(null);
          onLive(true);
        }
      } catch {
        if (live) { setProblem(SNAPSHOT_FAILED); onLive(false); }
      } finally {
        if (generation) {
          await engine.request("computer.invoke", {
            command: "computer.act", generation, idempotencyKey: crypto.randomUUID(),
            params: { action: "__close_execution", executionId, reason: "completion" },
          }).catch(() => undefined);
        }
        if (live) timer = setTimeout(() => void capture(), 1000);
      }
    };
    void capture();
    return () => { live = false; clearTimeout(timer); onLive(false); };
  }, [engine, retry, onLive]);
  if (!image) {
    return <div className="st7-wrap"><div className="st7-screen live-st">
      <PaneNote state={problem ? "stopped" : "connecting"} problem={problem} onRetry={onRetry} />
    </div></div>;
  }
  const frameStyle = ratio > 0 ? ({ "--frame-ratio": String(ratio) } as CSSProperties) : undefined;
  return <div className="st7-wrap"><div className="st7-screen live-st has-frame" style={frameStyle}>
    <img className="native-screen" src={image} alt="Live screen of this computer"
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
      }} />
  </div></div>;
}
