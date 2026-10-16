// Live picture and input for this computer's own screen. Copied from window/src/stage/NativeScreen.tsx:
// captures share one execution while you drive, and pointer actions aim at the last captured frame.
import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineLink } from "../pairing/pairingSession";
import { computerActions, type ComputerFrame } from "./computer-drive";
import { computerStatusProblem, type ComputerStatus, type StatusProblem } from "./computer-status-problem";
import type { RemoteAction } from "./remote-action";
import type { Size } from "../../../window/src/stage/remote-map";

type Status = ComputerStatus & { computerUse?: { provider: { generation: string } } };
type Frame = { format: "png" | "jpeg"; base64: string; displayFrameId?: string; width?: number; height?: number };

const SNAPSHOT_FAILED: StatusProblem = {
  line: "Couldn't show this computer's screen. Check that screen access is on, then try again.",
  retry: true,
};

export type NativeScreenState = {
  image: string | null;
  problem: StatusProblem | null;
  inputNote: string;
  frame: Size | null;
  remote: Size | null;
  send: (action: RemoteAction) => void;
};

export function useNativeScreen(link: EngineLink, control: boolean, newId: () => string, retry = 0, enabled = true): NativeScreenState {
  const [image, setImage] = useState<string | null>(null);
  const [problem, setProblem] = useState<StatusProblem | null>(null);
  const [inputNote, setInputNote] = useState("");
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const controlRef = useRef(control);
  controlRef.current = control;
  const shared = useRef<{ id: string; generation?: string; frame?: ComputerFrame } | null>(null);
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
      void link.request("computer.invoke", {
        command: "computer.act",
        generation: held.generation,
        idempotencyKey: newId(),
        params: { action: "__close_execution", executionId: held.id, reason: "completion" },
      }).catch(() => undefined);
    }
  }, [link, newId]);
  const captureNow = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!control) closeShared();
    else captureNow.current();
  }, [control, closeShared]);
  useEffect(() => {
    if (!enabled) {
      setImage(null);
      setProblem(null);
      setFrameSize(null);
      closeShared();
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false,
      again = false;
    setImage(null);
    setProblem(null);
    setFrameSize(null);
    const capture = async () => {
      busy = true;
      let generation: string | undefined;
      if (controlRef.current && !shared.current) shared.current = { id: newId() };
      const held = controlRef.current ? shared.current : null;
      const executionId = held?.id ?? newId();
      try {
        const status = await link.request<Status>("computer.status", {});
        if (!live) return;
        const stopped = computerStatusProblem(status);
        if (stopped) {
          setImage(null);
          setFrameSize(null);
          setProblem(stopped);
          return;
        }
        setProblem(null);
        generation = status.computerUse?.provider.generation;
        if (!status.available || !generation) throw new Error("Screen unavailable");
        const snap = generation;
        const result = await enqueue(() =>
          link.request<{ payload: Frame }>("computer.invoke", {
            command: "screen.snapshot",
            generation: snap,
            idempotencyKey: newId(),
            params: { executionId },
          }),
        );
        const frame = result.payload;
        if (!frame.base64 || (frame.format !== "jpeg" && frame.format !== "png")) throw new Error("No screen image");
        const width = frame.width ?? 0;
        const height = frame.height ?? 0;
        if (held && shared.current === held) {
          held.generation = generation;
          held.frame = frame.displayFrameId && width && height ? { id: frame.displayFrameId, width, height } : undefined;
        }
        if (live) {
          setImage(`data:image/${frame.format};base64,${frame.base64}`);
          if (width > 0 && height > 0) setFrameSize({ width, height });
          setProblem(null);
        }
      } catch {
        if (live) {
          setProblem(SNAPSHOT_FAILED);
          setImage(null);
        }
      } finally {
        if (generation && (!held || shared.current !== held)) {
          await link
            .request("computer.invoke", {
              command: "computer.act",
              generation,
              idempotencyKey: newId(),
              params: { action: "__close_execution", executionId, reason: "completion" },
            })
            .catch(() => undefined);
        }
        busy = false;
        if (!live) return;
        if (again) {
          again = false;
          void capture();
        } else {
          timer = setTimeout(() => {
            if (live) void capture();
          }, controlRef.current ? 500 : 1000);
          (timer as { unref?: () => void }).unref?.();
        }
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
    return () => {
      live = false;
      clearTimeout(timer);
      timer = undefined;
      captureNow.current = () => undefined;
      closeShared();
    };
  }, [link, enqueue, closeShared, newId, retry, enabled]);

  const pendingMove = useRef<RemoteAction | null>(null);
  const send = useCallback(
    (action: RemoteAction) => {
      if (!controlRef.current) return;
      const run = async (a: RemoteAction) => {
        const held = shared.current;
        if (!controlRef.current || !held?.frame || !held.generation) return;
        for (const params of computerActions(a, held.frame)) {
          await link.request("computer.invoke", {
            command: "computer.act",
            generation: held.generation,
            idempotencyKey: newId(),
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
    },
    [link, enqueue, newId],
  );

  const held = shared.current?.frame;
  const remote = held ? { width: held.width, height: held.height } : frameSize;
  return { image, problem, inputNote, frame: frameSize, remote, send };
}
