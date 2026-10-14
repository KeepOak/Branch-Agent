import type { WindowEngine } from "../../connect/engine";
import { Icon } from "../../shell/icons";
import type { Block } from "../../thread/model";
import { ComputerStage, type PipTarget, type StageMode } from "../../stage/ComputerStage";
import { StagePip } from "../../stage/StagePip";
import "./r1-stage.css";

type StageProps = { engine: WindowEngine; gatewayUrl: string; name: string; mode: StageMode; blocks: Block[]; running: boolean; onMode: (mode: StageMode) => void; onClose: () => void; onChooseComputer: () => void; onPip: (small: PipTarget) => void };

/**
 * The Classic computer stage, its picker and Add a computer, re-hosted unchanged inside the R1 frame (parity row 1).
 * Only this wrapper is R1: a clear glass surface (README item 48) that fills the conversation's main column above
 * the one composer, as the stage sits beside the conversation in Classic. The × at the end of the stage's top row
 * closes the view (design pass 17, "the full-size stage had no way out"); the frame owns Escape and focus return.
 */
export function R1Stage({ engine, gatewayUrl, name, mode, blocks, running, onMode, onClose, onChooseComputer, onPip }: StageProps) {
  return <section className="r1-stage g-clear" aria-label={mode === "Browser" ? `${name || "Conversation"}'s browser` : `${name || "Conversation"}'s computer`} data-mode={mode}>
    <ComputerStage engine={engine} gatewayUrl={gatewayUrl} name={name} mode={mode} blocks={blocks} running={running} onMode={onMode} onClose={onClose} onChooseComputer={onChooseComputer} onPip={onPip} />
    <button type="button" className="r1-stage-close" aria-label={mode === "Browser" ? "Close the browser view" : "Close the computer view"} title="Close" onClick={onClose}><Icon name="x" /></button>
  </section>;
}

/** The Classic small window over the conversation, re-hosted in the R1 frame. */
export function R1StagePip({ engine, gatewayUrl, name, computer, blocks, onOpen, onClose }: { engine: WindowEngine; gatewayUrl: string; name: string; computer: PipTarget; blocks: Block[]; onOpen: () => void; onClose: () => void }) {
  return <div className="r1-stage-pip"><StagePip engine={engine} gatewayUrl={gatewayUrl} name={name} computer={computer} blocks={blocks} onOpen={onOpen} onClose={onClose} /></div>;
}
