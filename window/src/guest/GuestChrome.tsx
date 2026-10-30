// The pieces around the owner's pages: back, forward and reload, the tab strip, the Trunk's access line, the question
// about the Trunk's first use, and the reader panel.
import { SIcon } from "../stage/stage-icons";
import type { GuestAccessState } from "./guest-access";
import { tabLabel, type GuestTab } from "./guest-tabs";

export function GuestNav({ canBack, canForward, disabled, onBack, onForward, onReload }: {
  canBack: boolean;
  canForward: boolean;
  disabled: boolean;
  onBack(): void;
  onForward(): void;
  onReload(): void;
}) {
  return (
    <div className="guest-nav">
      <button type="button" className="guest-tool" aria-label="Back" title="Back" disabled={disabled || !canBack} onClick={onBack}>
        <SIcon name="back" small />
      </button>
      <button type="button" className="guest-tool" aria-label="Forward" title="Forward" disabled={disabled || !canForward} onClick={onForward}>
        <SIcon name="forward" small />
      </button>
      <button type="button" className="guest-tool" aria-label="Reload" title="Reload" disabled={disabled} onClick={onReload}>
        <SIcon name="reload" small />
      </button>
    </div>
  );
}

export function GuestTabStrip({ tabs, activeId, onActivate, onClose, onNew }: {
  tabs: GuestTab[];
  activeId: string | null;
  onActivate(id: string): void;
  onClose(id: string): void;
  onNew(): void;
}) {
  return (
    <div className="guest-tabs">
      {tabs.map((tab) => {
        const label = tabLabel(tab);
        const showing = tab.id === activeId;
        return (
          <div key={tab.id} className="guest-tabitem" data-active={showing ? "true" : "false"}>
            <button type="button" className="guest-tabname" title={label} aria-current={showing ? "page" : undefined} onClick={() => onActivate(tab.id)}>
              {label}
            </button>
            <button type="button" className="guest-tabclose" aria-label={`Close ${label}`} onClick={() => onClose(tab.id)}>
              <SIcon name="x" small />
            </button>
          </div>
        );
      })}
      <button type="button" className="guest-newtab" aria-label="New tab" title="New tab" onClick={onNew}>
        <SIcon name="plus" small />
      </button>
    </div>
  );
}

export function GuestAccessBar({ state, trunkName, onTakeOver, onHandBack }: {
  state: GuestAccessState;
  trunkName: string;
  onTakeOver(): void;
  onHandBack(): void;
}) {
  if (state.access === "owner-control") {
    return (
      <div className="guest-access">
        <span className="stage-status-st">You have the page.</span>
        <button type="button" className="btn sm" onClick={onHandBack}>{`Hand back to ${trunkName}`}</button>
      </div>
    );
  }
  if (state.access === "allowed") {
    return (
      <div className="guest-access">
        <span className="stage-status-st">{`${trunkName} can read and click this page.`}</span>
        <button type="button" className="btn ghost sm" onClick={onTakeOver}>Take over</button>
      </div>
    );
  }
  return (
    <div className="guest-access">
      <span className="stage-status-st">{`${trunkName} can't read or click this page yet.`}</span>
    </div>
  );
}

export function GuestConsent({ onAllow, onNotNow }: { onAllow(): void; onNotNow(): void }) {
  return (
    <div className="guest-consent-scrim">
      <div className="guest-consent" role="dialog" aria-modal="true" aria-labelledby="guest-consent-question">
        <p id="guest-consent-question">Let your Trunk read and click the pages you open?</p>
        <div className="guest-consent-actions">
          <button type="button" className="btn ghost sm" onClick={onNotNow}>Not now</button>
          <button type="button" className="btn sm" onClick={onAllow}>Allow</button>
        </div>
      </div>
    </div>
  );
}

export function GuestReader({ text, onClose }: { text: string; onClose(): void }) {
  return (
    <div className="guest-reader" role="region" aria-label="Reader">
      <div className="guest-reader-top">
        <button type="button" className="btn ghost sm" onClick={onClose}>Close reader</button>
      </div>
      <div className="guest-reader-text">{text}</div>
    </div>
  );
}
