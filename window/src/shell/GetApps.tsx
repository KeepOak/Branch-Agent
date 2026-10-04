// Person menu › Get the apps (the preview's appsPA18): a tile per app, and Pair a phone, which pairs for real.
import { Dialog } from "./Dialog";
import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { desktopControls, IN_BROWSER } from "../connect/desktop-controls";

/** In a plain browser there is no Branch app to open the page from. */
export const GET_IT_OFF = "Opens the download page in your browser from the Branch app on your computer.";
// [icon, name, where, the Branch app's download id (desktop/src/desktop-controls.ts DOWNLOAD_PAGES)]
const APPS: [IconName, string, string, string][] = [
  ["phone", "iPhone", "The App Store", "iphone"],
  ["phone", "Android", "Google Play", "android"],
  ["monitor", "Mac", "A download for macOS", "mac"],
  ["monitor", "Windows", "A download for Windows", "windows"],
  ["term", "Linux", "AppImage and .deb", "linux"],
  ["globe", "Browser extension", "Chrome and Edge web stores", "extension"],
];

export function GetAppsDialog({ onClose, onPair }: { onClose: () => void; onPair: () => void }) {
  const [found] = useState(desktopControls);
  const [error, setError] = useState<string | null>(null);
  const off = "off" in found ? (found.off === IN_BROWSER ? GET_IT_OFF : found.off) : undefined;
  const open = (id: string) => {
    if (!("bridge" in found)) return;
    setError(null);
    found.bridge.openDownload(id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <Dialog title="Get the apps" wide onClose={onClose} testid="get-apps"
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Close</button><button type="button" className="btn pri" onClick={onPair}>Pair a phone</button></>}>
      <div className="appsPA18">
        {APPS.map(([icon, name, where, id]) => (
          <div className="tile" key={name}>
            <div className="th"><span className="ico-tile"><Icon name={icon} small /></span><b>{name}</b></div>
            <p>{where}</p>
            <button type="button" className="btn sm" disabled={off !== undefined} title={off} onClick={() => open(id)}>Get it</button>
          </div>
        ))}
      </div>
      {error ? <p className="hint" role="alert">{error}</p> : null}
    </Dialog>
  );
}
