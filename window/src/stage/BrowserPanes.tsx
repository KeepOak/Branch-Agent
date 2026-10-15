// The browser stage's two views: the owner's own browser (when this window is a desktop window that can host one)
// and the Trunk's browser. Without the desktop bridge, the stage is exactly the Trunk's browser.
import { useState, type ComponentProps } from "react";
import { BrowserView } from "./BrowserView";
import { GuestBrowser } from "../guest/GuestBrowser";
import { guestBridge } from "../guest/guest-bridge";
import "../guest/guest.css";

type BrowserProps = ComponentProps<typeof BrowserView>;
type Pane = "yours" | "trunks";

export function BrowserPanes(props: BrowserProps) {
  const bridge = guestBridge();
  const [pane, setPane] = useState<Pane>(() => (bridge?.local ? "yours" : "trunks"));
  if (!bridge) return <BrowserView {...props} />;
  return (
    <>
      <div className="guest-switch" role="group" aria-label="Which browser">
        <button type="button" aria-pressed={pane === "yours"} onClick={() => setPane("yours")}>Your browser</button>
        <button type="button" aria-pressed={pane === "trunks"} onClick={() => setPane("trunks")}>Trunk&apos;s browser</button>
      </div>
      <div className="guest-slot" data-shown={pane === "yours" ? "true" : "false"}>
        <GuestBrowser engine={props.engine} sessionKey={props.engine.sessionKey} trunkName={props.name} bridge={bridge} visible={pane === "yours"} />
      </div>
      {pane === "trunks" ? <BrowserView {...props} /> : null}
    </>
  );
}
