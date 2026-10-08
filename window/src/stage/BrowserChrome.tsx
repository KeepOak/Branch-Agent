import type { CSSProperties } from "react";
import type { MenuAnchor } from "../shell/Menu";
import { SIcon } from "./stage-icons";
import { DEFAULT_READ_MODE, READ_MODES, type DriveMode } from "./browser-chrome";

const NO_READS = "Choosing how it reads pages isn't wired in this window yet.";
const NO_NUMBERS = "The engine can't show its numbers on the live page yet.";
const NO_COMMENT = "The engine can't take comments pinned to a page yet.";
const NO_RECORD = "The engine can't record what you do in the browser yet.";

/** The preview's `barBrR218`: Reads Page/Picture/Both, Numbers, Comment, Record, Page, Tools. */
export function BrowserModeStrip({
  readMode = DEFAULT_READ_MODE,
  drawer,
  pageEnabled,
  toolsEnabled,
  onPageMenu,
  onTools,
}: {
  readMode?: typeof DEFAULT_READ_MODE;
  drawer: boolean;
  pageEnabled: boolean;
  toolsEnabled: boolean;
  onPageMenu: (at: MenuAnchor) => void;
  onTools: () => void;
}) {
  return (
    <div className="bar-br" role="toolbar" aria-label="Browser tools">
      <span className="lbl-br">Reads</span>
      <span className="seg-br" role="group" aria-label="How it reads the page" title={NO_READS}>
        {READ_MODES.map(([id, label]) => (
          <button key={id} type="button" disabled aria-pressed={id === readMode}>
            {label}
          </button>
        ))}
      </span>
      <button type="button" className="btn ghost sm tb-br" disabled title={NO_NUMBERS}>
        <SIcon name="hash" small />
        <span>Numbers</span>
      </button>
      <button type="button" className="btn ghost sm tb-br" disabled title={NO_COMMENT}>
        <SIcon name="comment" small />
        <span>Comment</span>
      </button>
      <button type="button" className="btn ghost sm tb-br" disabled title={NO_RECORD}>
        <SIcon name="record" small />
        <span>Record</span>
      </button>
      <button
        type="button"
        className="btn ghost sm tb-br"
        aria-haspopup="menu"
        disabled={!pageEnabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPageMenu({ x: r.left, y: r.bottom + 6 });
        }}
      >
        <SIcon name="doc" small />
        <span>Page</span>
        <SIcon name="down" small />
      </button>
      <span className="tb-grow" />
      <button type="button" className="btn ghost sm tb-br" aria-pressed={drawer} disabled={!toolsEnabled} onClick={onTools}>
        <SIcon name="tools" small />
        <span>Tools</span>
      </button>
    </div>
  );
}

/** The preview's `stBannerT5`: one-time note, dismissed with Got it. */
export function BrowserFirstUseBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="st-banner-br" role="note">
      <span className="grow">
        <b>Your screen, mouse and apps.</b> It asks before an app it hasn’t used. Touch the mouse to pause it; Ctrl+Alt+Shift+Esc
        stops everything. You talk to it in the chat beside this view.
      </span>
      <button type="button" className="btn sm" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}

/** The preview's `bannerBrR218` watch state: the Trunk is using the page. */
export function BrowserWatchBanner({ name, onTakeOver }: { name: string; onTakeOver: () => void }) {
  return (
    <div className="bn-br ctl-bn-br" role="note" style={{ "--c": "var(--accent)" } as CSSProperties}>
      <i className="dot-br" />
      <span className="grow">
        <b>{name} is using this page.</b> Your clicks and typing wait while it acts.
      </span>
      <button type="button" className="btn pri sm" onClick={onTakeOver}>
        Take over
      </button>
    </div>
  );
}

/** The preview's `you7` overlay while you have the page. */
export function BrowserDrivingTag({ name }: { name: string }) {
  return <span className="you7">You’re driving · {name} is paused</span>;
}

export function browserChromeState(drive: DriveMode, connected: boolean) {
  return {
    watch: drive === "watch" && connected,
    drive: drive === "drive" && connected,
  };
}
