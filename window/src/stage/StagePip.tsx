import { useRef } from "react";
import type { WindowEngine } from "../connect/engine";
import { SIcon } from "./stage-icons";
import { useDesktopView } from "./use-desktop";
import "./stage.css";

/** The computer shrunk to a small window over the conversation: a view-only screen, open full size, close. */
export function StagePip({ engine, gatewayUrl, name, computer, onOpen, onClose }: { engine: WindowEngine; gatewayUrl: string; name: string; computer: { id: string; name: string }; onOpen: () => void; onClose: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const view = useDesktopView(engine, gatewayUrl, computer.id, target, false, 0);
  return (
    <div className="pip7" role="region" aria-label={`${name}'s computer, small`}>
      <button type="button" className="pip7-screen" aria-label="Open full size" onClick={onOpen}>
        <span className="stage-screen" ref={target} />
        {view.phase !== "connected" ? <span className="cell-note-st">{view.phase === "loading" ? "Connecting…" : view.message || "No screen to show"}</span> : null}
      </button>
      <div className="pip7-bar">
        <span>
          {name} · {computer.name}
        </span>
        <button type="button" aria-label="Open full size" onClick={onOpen}>
          <SIcon name="up" small />
        </button>
        <button type="button" aria-label="Close the small window" onClick={onClose}>
          <SIcon name="x" small />
        </button>
      </div>
    </div>
  );
}
