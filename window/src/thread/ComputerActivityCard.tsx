import { useEffect, useRef, useState } from "react";
import type { Block } from "./model";
import type { WindowEngine } from "../connect/engine";
import { SIcon } from "../stage/stage-icons";
import { useDesktopView } from "../stage/use-desktop";
import { describePlacement, placementComputer } from "../stage/computers";
import { computerActivityTurns, isComputerStep } from "./computer-activity";
import "../stage/stage.css";

export type ComputerMode = "Computer" | "Browser";

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
function Thumb({ engine, gatewayUrl, id, onOpen }: { engine: WindowEngine; gatewayUrl: string; id: string; onOpen: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const view = useDesktopView(engine, gatewayUrl, id, target, false, 0);
  return (
    <button type="button" className="comp-thumb-st" aria-label="Open the computer full size" onClick={onOpen}>
      <span className="stage-screen" ref={target} />
      {view.phase !== "connected" ? <span className="cell-note-st">{view.phase === "loading" ? "Connecting…" : view.message || "No screen to show"}</span> : null}
    </button>
  );
}

export type ComputerActivityProps = {
  blocks: readonly Block[];
  running: boolean;
  name: string;
  onWatch: (mode: ComputerMode, takeOver?: boolean) => void;
  engine?: WindowEngine;
  gatewayUrl?: string;
};

/**
 * The computer or browser in the conversation: while it works, a live card (picture, Watch full size, Take over);
 * after, "Used <computer> · N actions" with each action it took. One card per turn (preview `actsCuR218`).
 */
export function ComputerActivityCard(props: ComputerActivityProps) {
  const turns = computerActivityTurns(props.blocks);
  if (!turns.length) return null;
  if (turns.length === 1) return <TurnCard {...props} blocks={turns[0]} />;
  return (
    <>
      {turns.map((steps) => (
        <TurnCard key={steps[0].key} {...props} blocks={steps} />
      ))}
    </>
  );
}

function TurnCard({
  blocks,
  running,
  name,
  onWatch,
  engine,
  gatewayUrl,
}: ComputerActivityProps) {
  const [open, setOpen] = useState(false);
  const steps = blocks.filter(isComputerStep);
  const computer = useComputerName(steps.length ? engine : undefined);
  const latest = steps.at(-1);
  if (!latest) return null;
  const mode: ComputerMode = /browser/i.test(latest.tool) ? "Browser" : "Computer";
  const where = mode === "Browser" ? `${name}'s browser` : computer.name || `${name}'s computer`;
  const live = running && latest.status === "running";
  if (live)
    return (
      <section className="card-st comp-card-st" aria-label={`${mode} activity`} data-testid="computer-activity">
        <div className="card-h-st">
          <b>
            <SIcon name={mode === "Browser" ? "globe" : "monitor"} small />
            {where}
          </b>
          <span className="pill work">
            <i />
            Working
          </span>
        </div>
        <p className="card-sub-st">{latest.title}</p>
        {mode === "Computer" && engine && gatewayUrl && computer.id ? <Thumb engine={engine} gatewayUrl={gatewayUrl} id={computer.id} onOpen={() => onWatch(mode)} /> : null}
        <div className="card-acts-st">
          <button type="button" className="btn pri sm" onClick={() => onWatch(mode)}>
            <SIcon name="monitor" small />
            Watch full size
          </button>
          {mode === "Computer" && computer.id ? (
            <button type="button" className="btn sm" onClick={() => onWatch(mode, true)}>
              Take over
            </button>
          ) : null}
        </div>
      </section>
    );
  const count = steps.length;
  const summary = steps
    .slice(0, 3)
    .map((s) => s.title)
    .join(", ");
  return (
    <section className="card-st acts-card-st" aria-label={`${mode} activity`} data-testid="computer-activity">
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
        <SIcon name="chev" small className="acts-chev-st" />
      </button>
      {open ? (
        <>
          <ol className="acts-list-st">
            {steps.map((s) => (
              <li key={s.key} className={s.status}>
                <SIcon name={s.status === "ok" ? "check" : s.status === "running" ? "spin" : "x"} small />
                <span className="grow">
                  <b>{s.title}</b>
                  {s.detail ? <small>{s.detail}</small> : null}
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
