import { useEffect, useRef, useState } from "react";
import type { Block } from "./model";
import type { WindowEngine } from "../connect/engine";
import { BrowserMini } from "../stage/BrowserView";
import { SIcon } from "../stage/stage-icons";
import { useDesktopView } from "../stage/use-desktop";
import { describePlacement, placementComputer } from "../stage/computers";
import "../stage/stage.css";
import { computerSafeCaption, plainStepTitle } from "./computer-action-label";
import {
  announceComputerControl,
  computerCardState,
  listenComputerControl,
  runWasStopped,
  type ComputerCardState,
} from "./computer-card";

type Mode = "Computer" | "Browser";
type Step = Extract<Block, { kind: "step" }>;
const isComputer = (b: Block): b is Step => b.kind === "step" && /browser|computer|screen|desktop/i.test(b.tool);

const PILL: Record<ComputerCardState, { className: string; text: string }> = {
  working: { className: "work", text: "Working" },
  yours: { className: "you", text: "You have control" },
  stopped: { className: "no", text: "Stopped" },
  done: { className: "done", text: "Done" },
};

/** The conversation's computer: its own label from the engine, or This computer for the host. */
function useComputerName(engine: WindowEngine | undefined): { id: string | null; name: string } {
  const [state, setState] = useState<{ owner?: WindowEngine; id: string | null; name: string }>({ id: null, name: "" });
  useEffect(() => {
    if (!engine) return;
    let live = true;
    void (async () => {
      const id = placementComputer(await describePlacement(engine));
      if (!id) return live && setState({ owner: engine, id: null, name: "" });
      const env = await engine.request<{ id?: string; label?: string }>("environments.status", { environmentId: id }).catch(() => null);
      if (live) setState({ owner: engine, id, name: id === "gateway" ? "This computer" : env?.label || id });
    })().catch(() => live && setState({ owner: engine, id: null, name: "" }));
    return () => {
      live = false;
    };
  }, [engine]);
  return state.owner === engine ? state : { id: null, name: "" };
}

/** A small live picture of the computer while it works (view only). */
function ComputerThumb({
  engine,
  gatewayUrl,
  id,
  yours,
  onOpen,
}: {
  engine: WindowEngine;
  gatewayUrl: string;
  id: string;
  yours: boolean;
  onOpen: () => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const view = useDesktopView(engine, gatewayUrl, id, target, false, 0);
  return (
    <button type="button" className="comp-thumb-st" aria-label="Open the computer full size" onClick={onOpen}>
      <span className="stage-screen" ref={target} />
      {view.phase !== "connected" ? <span className="cell-note-st">{view.phase === "loading" ? "Connecting…" : view.message || "No screen to show"}</span> : null}
      {yours ? <span className="drive-st">You're driving</span> : null}
    </button>
  );
}

/** A small live picture of the browser; the same card chrome as the computer. */
function BrowserThumb({
  engine,
  gatewayUrl,
  blocks,
  yours,
  onOpen,
}: {
  engine: WindowEngine;
  gatewayUrl: string;
  blocks: Block[];
  yours: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="comp-thumb-st" aria-label="Open the browser full size" onClick={onOpen}>
      <span className="stage-screen">
        <BrowserMini engine={engine} gatewayUrl={gatewayUrl} blocks={blocks} />
      </span>
      {yours ? <span className="drive-st">You're driving</span> : null}
    </button>
  );
}

/**
 * The computer or browser in the conversation. Four states from the preview's computerCard:
 * Working (Watch full size · Take over), You have control (Hand back · Open full size),
 * Stopped (Carry on), Done (no actions). The live picture opens full size for both.
 */
export function ComputerActivityCard({
  blocks,
  running,
  name,
  onWatch,
  engine,
  gatewayUrl,
  controlling: controllingProp,
  onHandBack,
}: {
  blocks: Block[];
  running: boolean;
  name: string;
  onWatch: (mode: Mode, takeOver?: boolean) => void;
  engine?: WindowEngine;
  gatewayUrl?: string;
  /** The real take-over (WindowShell's stageTakeOver or the stage's control). */
  controlling?: boolean;
  /** Clears the parent take-over. The stage also hears `branch:computer-control`. */
  onHandBack?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [takeOver, setTakeOver] = useState(false);
  const steps = blocks.filter(isComputer);
  const latest = steps.at(-1);
  useEffect(() => {
    if (latest?.status !== "running") return;
    return listenComputerControl(setTakeOver);
  }, [latest?.status]);
  const computer = useComputerName(steps.length ? engine : undefined);
  if (!latest) return null;
  const mode: Mode = /browser/i.test(latest.tool) ? "Browser" : "Computer";
  const where = `${name}'s ${mode === "Browser" ? "browser" : "computer"}`;
  const actionTitle = (step: Step) => (/browser/i.test(step.tool) ? step.title : plainStepTitle(step));
  const actionCaption = (step: Step) => (/browser/i.test(step.tool) ? step.detail : computerSafeCaption(step.detail));
  const controlling = controllingProp ?? takeOver;
  const state = computerCardState({
    running,
    status: latest.status,
    controlling,
    stopped: runWasStopped(blocks),
  });
  const pill = PILL[state];
  const thumb =
    engine && gatewayUrl ? (
      mode === "Browser" ? (
        <BrowserThumb engine={engine} gatewayUrl={gatewayUrl} blocks={blocks} yours={state === "yours"} onOpen={() => onWatch(mode)} />
      ) : computer.id ? (
        <ComputerThumb engine={engine} gatewayUrl={gatewayUrl} id={computer.id} yours={state === "yours"} onOpen={() => onWatch(mode)} />
      ) : null
    ) : null;
  const takeOverNow = () => {
    setTakeOver(true);
    announceComputerControl(true);
    onWatch(mode, true);
  };
  const handBack = () => {
    setTakeOver(false);
    announceComputerControl(false);
    onHandBack?.();
    onWatch(mode, false);
  };
  const carryOn = () => {
    void engine?.send?.("Carry on");
  };
  const acts =
    state === "working" ? (
      <>
        <button type="button" className="btn pri sm" onClick={() => onWatch(mode)}>
          <SIcon name="monitor" small />
          Watch full size
        </button>
        <button type="button" className="btn sm" onClick={takeOverNow}>
          Take over
        </button>
      </>
    ) : state === "yours" ? (
      <>
        <button type="button" className="btn pri sm" onClick={handBack}>
          Hand back to {name}
        </button>
        <button type="button" className="btn sm" onClick={() => onWatch(mode)}>
          Open full size
        </button>
      </>
    ) : state === "stopped" ? (
      <button
        type="button"
        className="btn sm"
        onClick={carryOn}
        disabled={!engine?.send}
        title={engine?.send ? undefined : "Send a message to carry on."}
      >
        Carry on
      </button>
    ) : null;
  const count = steps.length;
  const summary = steps
    .slice(0, 3)
    .map((s) => actionTitle(s))
    .join(", ");
  if (state === "done") {
    return (
      <section className="card-st acts-card-st" aria-label={`${where}: ${pill.text}`} data-state={state}>
        <button type="button" className="acts-head-st" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <SIcon name={mode === "Browser" ? "globe" : "monitor"} small />
          <span className="grow">
            <b>
              Used {where} · {count} action{count === 1 ? "" : "s"}
            </b>
            <small>
              {summary}
              {count > 3 ? "…" : ""}
            </small>
          </span>
          <span className={`pill ${pill.className}`}>
            <i />
            {pill.text}
          </span>
          <SIcon name="chev" small className="acts-chev-st" />
        </button>
        {open ? (
          <>
            <ol className="acts-list-st">
              {steps.map((s) => (
                <li key={s.key} className={s.status}>
                  <SIcon name={s.status === "ok" ? "check" : s.status === "running" ? "spin" : "x"} small />
                  <span className="grow">
                    <b>{actionTitle(s)}</b>
                    {actionCaption(s) ? <small>{actionCaption(s)}</small> : null}
                  </span>
                </li>
              ))}
            </ol>
            <div className="card-acts-st">
              <button type="button" className="btn ghost sm" onClick={() => onWatch(mode)}>
                <SIcon name={mode === "Browser" ? "globe" : "monitor"} small />
                Open the {mode === "Browser" ? "browser" : "computer"}
              </button>
            </div>
          </>
        ) : null}
      </section>
    );
  }
  return (
    <section className="card-st comp-card-st" aria-label={`${where}: ${pill.text}`} data-state={state}>
      <div className="card-h-st">
        <b>
          <SIcon name={mode === "Browser" ? "globe" : "monitor"} small />
          {where}
        </b>
        <span className={`pill ${pill.className}`}>
          <i />
          {pill.text}
        </span>
      </div>
      <p className="card-sub-st">{actionTitle(latest)}</p>
      {thumb}
      {acts ? <div className="card-acts-st">{acts}</div> : null}
    </section>
  );
}
