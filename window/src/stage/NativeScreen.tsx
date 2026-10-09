import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";

type Status = { available?: boolean; computerUse?: { provider: { generation: string } } };
type Frame = { format: "png" | "jpeg"; base64: string };
const MESSAGE = "Couldn't show this computer's screen. Check that screen access is on and try again.";

/** Native screen access uses the screen-and-mouse switch, not the separate VNC desktop setting.
 * Each capture releases its own execution immediately; opening this panel never keeps the computer occupied. */
export function NativeScreen({ engine, retry, onLive, onRetry }: { engine: WindowEngine; retry: number; onLive: (live: boolean) => void; onRetry: () => void }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setImage("");
    setError("");
    onLive(false);
    const capture = async () => {
      let generation: string | undefined;
      const executionId = crypto.randomUUID();
      try {
        const status = await engine.request<Status>("computer.status", {});
        if (!live) return;
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
          setError("");
          onLive(true);
        }
      } catch {
        if (live) { setError(MESSAGE); onLive(false); }
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
  return <div className="st7-wrap"><div className="st7-screen live-st">
    {image ? <img className="native-screen" src={image} alt="Live screen of this computer" /> : null}
    {!image || error ? <div className="stage-empty"><b>{error || "Connecting to this computer's screen…"}</b>{error ? <button type="button" className="btn" onClick={onRetry}>Try again</button> : null}</div> : null}
  </div></div>;
}
