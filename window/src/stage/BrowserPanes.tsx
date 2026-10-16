// The browser stage's two views: the owner's own browser (when this window is a desktop window that can host one)
// and the Trunk's browser. Without the desktop bridge, the stage is exactly the Trunk's browser.
import { useState, type ComponentProps } from "react";
import { BrowserView } from "./BrowserView";
import { GuestBrowser } from "../guest/GuestBrowser";
import { guestBridge } from "../guest/guest-bridge";
import "../guest/guest.css";

type BrowserProps = ComponentProps<typeof BrowserView>;
type Pane = "yours" | "trunks";

/** Why "Your browser" is greyed when the desktop can't hand the pane its pages' new tabs. */
export const YOUR_BROWSER_WHY = "Your browser comes in a later update.";

export function BrowserPanes(props: BrowserProps) {
  const bridge = guestBridge();
  // The Trunk's browser is the default on every start, local or remote, and nothing remembers the last pick:
  // Your browser opens only when the owner picks it.
  const [pane, setPane] = useState<Pane>("trunks");
  if (!bridge) return <BrowserView {...props} />;
  const canYours = bridge.onOpenTab !== null;
  const shown: Pane = canYours ? pane : "trunks";
  return (
    <>
      <div className="guest-switch" role="group" aria-label="Which browser">
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
      {canYours ? (
        <div className="guest-slot" data-shown={shown === "yours" ? "true" : "false"}>
          <GuestBrowser engine={props.engine} sessionKey={props.engine.sessionKey} trunkName={props.name} bridge={bridge} visible={shown === "yours"} />
        </div>
      ) : null}
      {shown === "trunks" ? <BrowserView {...props} /> : null}
    </>
  );
}
