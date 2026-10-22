// Person menu › Get the apps (the preview's appsPA18): a tile per app, and Pair a phone, which pairs for real.
import { Dialog } from "./Dialog";
import { shownWhy } from "./shown-why";
import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { desktopControls, IN_BROWSER } from "../connect/desktop-controls";
import { shows, useLevel } from "../places-nav/level";

/** In a plain browser there is no Branch app to open the page from. */
export const GET_IT_OFF = "Opens the download page in your browser from the Branch app on your computer.";
/** iPhone and the browser extension have no Branch release yet: this one line, and no button. */
export const NOT_OUT_YET = "Not out yet. Use the Android, Mac, Windows or Linux app for now.";
// [icon, name, where, the Branch app's download id (desktop/src/desktop-controls.ts RELEASE_DOWNLOADS).
//  No id means no button and no link; those rows show only at Technical.]
const APPS: [IconName, string, string, string | undefined][] = [
  ["phone", "iPhone", NOT_OUT_YET, undefined],
  ["phone", "Android", "Signed APK", "android"],
  ["monitor", "Mac", "macOS disk image", "mac"],
  ["monitor", "Windows", "Windows setup", "windows"],
  ["term", "Linux", "AppImage", "linux"],
  ["globe", "Browser extension", NOT_OUT_YET, undefined],
];

export function GetAppsDialog({ onClose, onPair }: { onClose: () => void; onPair: () => void }) {
  const level = useLevel();
  const [found] = useState(desktopControls);
  const [error, setError] = useState<string | null>(null);
  const off = "off" in found ? (found.off === IN_BROWSER ? GET_IT_OFF : found.off) : undefined;
  const apps = APPS.filter(([, , , id]) => id !== undefined || shows(level, "technical"));
  const open = (id: string) => {
    if (!("bridge" in found)) return;
    setError(null);
    found.bridge.openDownload(id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <Dialog title="Get the apps" wide onClose={onClose} testid="get-apps"
      footer={<button type="button" className="btn pri" onClick={onPair}>Pair a phone</button>}>
      <div className="appsPA18">
        {apps.map(([icon, name, where, id]) => (
          <div className="tile" key={name}>
            <div className="th"><span className="ico-tile"><Icon name={icon} small /></span><b>{name}</b></div>
            <p>{where}</p>
            {id ? <button type="button" className="btn sm" disabled={off !== undefined} title={shownWhy(off)} onClick={() => open(id)}>Get it</button> : null}
          </div>
        ))}
      </div>
      {error ? <p className="hint" role="alert">{error}</p> : null}
    </Dialog>
  );
}
