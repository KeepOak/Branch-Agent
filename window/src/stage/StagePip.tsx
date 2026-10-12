import { useRef } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { BrowserMini } from "./BrowserView";
import type { PipTarget } from "./ComputerStage";
import { SIcon } from "./stage-icons";
import { useDesktopView } from "./use-desktop";
import "./stage.css";

type Props = { engine: WindowEngine; gatewayUrl: string; name: string; computer: PipTarget; blocks: Block[]; onOpen: () => void; onClose: () => void };

/** The computer or the browser shrunk to a small window over the conversation (the preview's pip7): a view-only
 *  picture, open full size, close. */
export function StagePip({ engine, gatewayUrl, name, computer, blocks, onOpen, onClose }: Props) {
  return (
    <div className="pip7" role="region" aria-label={computer.kind === "browser" ? `${name}'s browser, small` : `${name}'s computer, small`}>
      <button type="button" className="pip7-screen" aria-label="Open full size" onClick={onOpen}>
        {computer.kind === "browser" ? <span className="stage-screen"><BrowserMini engine={engine} gatewayUrl={gatewayUrl} blocks={blocks} /></span> : <DesktopMini engine={engine} gatewayUrl={gatewayUrl} id={computer.id} />}
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

function DesktopMini({ engine, gatewayUrl, id }: { engine: WindowEngine; gatewayUrl: string; id: string }) {
  const target = useRef<HTMLDivElement>(null);
  const view = useDesktopView(engine, gatewayUrl, id, target, false, 0);
  return (
    <>
      <span className="stage-screen" ref={target} />
      {view.phase !== "connected" ? <span className="cell-note-st">{view.phase === "loading" ? "Connecting…" : view.message || "No screen to show"}</span> : null}
    </>
  );
}
