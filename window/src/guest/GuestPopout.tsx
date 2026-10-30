// The pop-out window: the owner's browser alone, full window, opened from the pane's "Open in a window" button.
import { useState } from "react";
import { GuestBrowser } from "./GuestBrowser";
import { guestBridge, popoutAddress } from "./guest-bridge";

export function GuestPopout() {
  // Read once, when the window opens.
  const [startUrl] = useState(() => popoutAddress() ?? "");
  return (
    <div className="guest-window">
      <GuestBrowser bridge={guestBridge()} startUrl={startUrl} full />
    </div>
  );
}
