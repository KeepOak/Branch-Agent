// The browser stage's two views: the owner's own browser (when this window is a desktop window that can host one)
// and the Trunk's browser. Without the desktop bridge, the stage is exactly the Trunk's browser.
import { useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { BrowserView } from "./BrowserView";
import { GuestBrowser } from "../guest/GuestBrowser";
import { guestBridge } from "../guest/guest-bridge";
import "../guest/guest.css";

/** `switchSlot`: where the Your | Trunk's browser switch draws (the stage header, #1103). Without one it draws above the page. */
type BrowserProps = ComponentProps<typeof BrowserView> & { switchSlot?: HTMLElement | null };
type Pane = "yours" | "trunks";

/** Why "Your browser" is greyed when the desktop can't hand the pane its pages' new tabs. */
export const YOUR_BROWSER_WHY = "Your browser comes in a later update.";

export function BrowserPanes({ switchSlot, ...props }: BrowserProps) {
  const bridge = guestBridge();
  // The Trunk's browser is the default on every start, local or remote, and nothing remembers the last pick:
  // Your browser opens only when the owner picks it.
  const [pane, setPane] = useState<Pane>("trunks");
  if (!bridge) return <BrowserView {...props} />;
  const canYours = bridge.onOpenTab !== null;
  const shown: Pane = canYours ? pane : "trunks";
  const which = (
    <div className="guest-switch" data-in-header={switchSlot ? "" : undefined} role="group" aria-label="Which browser">
      <button
        type="button"
        aria-pressed={shown === "yours"}
        disabled={!canYours}
        title={canYours ? undefined : YOUR_BROWSER_WHY}
        data-coming={canYours ? undefined : YOUR_BROWSER_WHY}
        onClick={() => setPane("yours")}
      >
        Your browser
      </button>
      <button type="button" aria-pressed={shown === "trunks"} onClick={() => setPane("trunks")}>Trunk&apos;s browser</button>
    </div>
  );
  return (
    <>
      {switchSlot ? createPortal(which, switchSlot) : which}
      {canYours ? (
        <div className="guest-slot" data-shown={shown === "yours" ? "true" : "false"}>
          <GuestBrowser engine={props.engine} sessionKey={props.engine.sessionKey} trunkName={props.name} bridge={bridge} visible={shown === "yours"} />
        </div>
      ) : null}
      {shown === "trunks" ? <BrowserView {...props} /> : null}
    </>
  );
}
