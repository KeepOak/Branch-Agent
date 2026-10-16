import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { shows, useLevel } from "../places-nav/level";
import { frameIsBlank } from "./blank-frame";
import { type ComputerStatus, computerStatusProblem, screenPermissionProblem, type StatusProblem } from "./computer-status-problem";
import { BLANK_CAPTURE, isScreenPermissionError, onMac, openScreenRecordingSettings, PERMISSION_POLL_MS } from "./screen-permission";
import { DriveSurface, type RemoteAction } from "./DriveSurface";
import { computerActions, type ComputerFrame } from "./computer-drive";

type Status = ComputerStatus & { computerUse?: { provider: { generation: string } } };
type Frame = { format: "png" | "jpeg"; base64: string; displayFrameId?: string; width?: number; height?: number };
const SNAPSHOT_FAILED: StatusProblem = {
  line: "Couldn't show this computer's screen. Check that screen access is on, then try again.",
  retry: true,
};

/** A failed capture in plain words; the raw error goes behind Technical details. */
function snapshotProblem(error: unknown): StatusProblem {
  const technical = (error instanceof Error ? error.message : String(error)).trim() || undefined;
  if (isScreenPermissionError(technical)) return screenPermissionProblem(technical);
  return technical ? { ...SNAPSHOT_FAILED, technical } : SNAPSHOT_FAILED;
}

/** One centered line with at most one action, in the pane's own box. The raw detail shows only at Technical.
 * While macOS holds the screen back, the action opens System Settings and the pane keeps trying by itself. */
function PaneNote({ state, problem, onRetry }: { state: string; problem: StatusProblem | null; onRetry: () => void }) {
  const technical = shows(useLevel(), "technical");
  return <div className="stage-empty pane-note" data-pane-state={state} data-permission={problem?.permission || undefined}>
    <p>{problem ? problem.line : "Connecting…"}</p>
    {problem?.permission ? <button type="button" className="btn" onClick={() => openScreenRecordingSettings()}>Open System Settings</button>
      : problem?.retry ? <button type="button" className="btn" onClick={onRetry}>Try again</button> : null}
    {technical && problem?.technical ? <details className="pane-technical"><summary>Technical details</summary><code>{problem.technical}</code></details> : null}
  </div>;
}

/** Native screen access uses the screen-and-mouse switch, not the separate VNC desktop setting.
 * Each capture releases its own execution immediately; opening this panel never keeps the computer occupied.
 * While you have the computer (`control`), captures and your input share one execution, because the provider only
 * accepts a pointer action aimed at a frame it captured in that same execution; it is released when you hand back. */
export function NativeScreen({ engine, retry, onLive, onRetry, control = false, driving = "" }: { engine: WindowEngine; retry: number; onLive: (live: boolean) => void; onRetry: () => void; control?: boolean; driving?: string }) {
  const [image, setImage] = useState("");
  const [problem, setProblem] = useState<StatusProblem | null>(null);
  const [inputNote, setInputNote] = useState("");
  // Width over height of the live frame, so the frame fills the pane width with no letterbox bands.
  const [ratio, setRatio] = useState(0);
  const controlRef = useRef(control);
  controlRef.current = control;
  /** The execution your input and captures share while you drive, with the frame last captured in it. */
  const shared = useRef<{ id: string; generation?: string; frame?: ComputerFrame } | null>(null);
  /** Captures and input in the order they were made, so input is always aimed at the newest frame. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);
  const closeShared = useCallback(() => {
    const held = shared.current;
    shared.current = null;
    if (held?.generation) {
      void engine.request("computer.invoke", {
        command: "computer.act", generation: held.generation, idempotencyKey: crypto.randomUUID(),
        params: { action: "__close_execution", executionId: held.id, reason: "completion" },
      }).catch(() => undefined);
    }
  }, [engine]);
  /** Takes the next picture now instead of at the next poll: set by the capture loop below. */
  const captureNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!control) closeShared();
    // Taking over captures at once in the shared execution, so your first click has a frame to aim at.
    else captureNow.current();
  }, [control, closeShared]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false, again = false;
    setImage("");
    setProblem(null);
    onLive(false);
    const capture = async () => {
      busy = true;
      // While macOS holds the screen back, try again every few seconds; the screen shows by itself once it's allowed.
      let waitMs = controlRef.current ? 500 : 1000;
      let generation: string | undefined;
      if (controlRef.current && !shared.current) shared.current = { id: crypto.randomUUID() };
      const held = controlRef.current ? shared.current : null;
      const executionId = held?.id ?? crypto.randomUUID();
      try {
        const status = await engine.request<Status>("computer.status", {});
        if (!live) return;
        const stopped = computerStatusProblem(status);
        if (stopped) {
          setImage("");
          setProblem(stopped);
          onLive(false);
          if (stopped.permission) waitMs = PERMISSION_POLL_MS;
          return;
        }
        setProblem(null);
        generation = status.computerUse?.provider.generation;
        if (!status.available || !generation) throw new Error("Screen unavailable");
        const snap = generation;
        const result = await enqueue(() => engine.request<{ payload: Frame }>("computer.invoke", {
          command: "screen.snapshot", generation: snap, idempotencyKey: crypto.randomUUID(),
          params: { executionId },
        }));
        const frame = result.payload;
        if (!frame.base64 || (frame.format !== "jpeg" && frame.format !== "png")) throw new Error("No screen image");
        // An all-black capture on a Mac is macOS refusing it: say so, and keep trying until a real frame comes.
        if (onMac() && await frameIsBlank(frame.format, frame.base64)) {
          if (live) { setImage(""); setProblem(screenPermissionProblem(BLANK_CAPTURE)); onLive(false); }
          waitMs = PERMISSION_POLL_MS;
          return;
        }
        if (held && shared.current === held) {
          held.generation = generation;
          held.frame = frame.displayFrameId && frame.width && frame.height ? { id: frame.displayFrameId, width: frame.width, height: frame.height } : undefined;
        }
        if (live) {
          setImage(`data:image/${frame.format};base64,${frame.base64}`);
          setProblem(null);
          onLive(true);
        }
      } catch (error) {
        const problem = snapshotProblem(error);
        if (problem.permission) waitMs = PERMISSION_POLL_MS;
        if (live) { if (problem.permission) setImage(""); setProblem(problem); onLive(false); }
      } finally {
        // A capture's own execution is released at once; so is a shared one you handed back while it was in flight.
        if (generation && (!held || shared.current !== held)) {
          await engine.request("computer.invoke", {
            command: "computer.act", generation, idempotencyKey: crypto.randomUUID(),
            params: { action: "__close_execution", executionId, reason: "completion" },
          }).catch(() => undefined);
        }
        busy = false;
        if (live && again) {
          again = false;
          void capture();
        } else if (live) timer = setTimeout(() => void capture(), waitMs);
      }
    };
    captureNow.current = () => {
      if (!live) return;
      if (busy) {
        again = true;
        return;
      }
      clearTimeout(timer);
      void capture();
    };
    void capture();
    return () => { live = false; clearTimeout(timer); captureNow.current = () => undefined; onLive(false); closeShared(); };
  }, [engine, retry, onLive, enqueue, closeShared]);
  // Pointer moves only matter where they end: while one waits to go, a newer one replaces it.
  const pendingMove = useRef<RemoteAction | null>(null);
  const send = useCallback((action: RemoteAction) => {
    if (!controlRef.current) return;
    const run = async (a: RemoteAction) => {
      const held = shared.current;
      if (!controlRef.current || !held?.frame || !held.generation) return;
      for (const params of computerActions(a, held.frame)) {
        await engine.request("computer.invoke", {
          command: "computer.act", generation: held.generation, idempotencyKey: crypto.randomUUID(),
          params: { ...params, executionId: held.id },
        });
      }
    };
    const failed = () => setInputNote("Your input couldn't reach this computer. Check that screen access is on, then try again.");
    const sent = () => setInputNote("");
    if (action.kind === "move") {
      const queued = pendingMove.current !== null;
      pendingMove.current = action;
      if (queued) return;
      void enqueue(async () => {
        const latest = pendingMove.current;
        pendingMove.current = null;
        if (latest) await run(latest);
      }).then(sent, failed);
      return;
    }
    void enqueue(() => run(action)).then(sent, failed);
  }, [engine, enqueue]);
  const natural = useRef<{ width: number; height: number } | null>(null);
  if (!image) {
    return <div className="st7-wrap"><div className="st7-screen live-st">
      <PaneNote state={problem ? "stopped" : "connecting"} problem={problem} onRetry={onRetry} />
    </div></div>;
  }
  const frameStyle = ratio > 0 ? ({ "--frame-ratio": String(ratio) } as CSSProperties) : undefined;
  return <div className="st7-wrap"><div className="st7-screen live-st has-frame" style={frameStyle}>
    <DriveSurface
      active={control}
      frame={() => natural.current}
      remote={() => {
        const f = shared.current?.frame;
        return f ? { width: f.width, height: f.height } : natural.current;
      }}
      send={send}
      typingLabel="Type on this computer"
    >
      <img className="native-screen" src={image} alt="Live screen of this computer"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) {
            natural.current = { width: naturalWidth, height: naturalHeight };
            setRatio(naturalWidth / naturalHeight);
          }
        }} />
    </DriveSurface>
    {control && driving ? <span className="drive-st">{driving}</span> : null}
    {inputNote ? <p role="alert" className="browser-input-error">{inputNote}</p> : null}
  </div></div>;
}
