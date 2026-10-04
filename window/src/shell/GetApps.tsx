// Person menu › Get the apps (the preview's appsPA18): a tile per app, and Pair a phone, which pairs for real.
import { Dialog } from "./Dialog";
import { Icon, type IconName } from "./icons";

// TODO(desktop-lane): "Get it" opens each app's download page in the browser through the Branch app's method.
export const GET_IT_OFF = "Opens the download page in your browser from the Branch app on your computer.";
const APPS: [IconName, string, string][] = [
  ["phone", "iPhone", "The App Store"],
  ["phone", "Android", "Google Play"],
  ["monitor", "Mac", "A download for macOS"],
  ["monitor", "Windows", "A download for Windows"],
  ["term", "Linux", "AppImage and .deb"],
  ["globe", "Browser extension", "Chrome and Edge web stores"],
];

export function GetAppsDialog({ onClose, onPair }: { onClose: () => void; onPair: () => void }) {
  return (
    <Dialog title="Get the apps" wide onClose={onClose} testid="get-apps"
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Close</button><button type="button" className="btn pri" onClick={onPair}>Pair a phone</button></>}>
      <div className="appsPA18">
        {APPS.map(([icon, name, where]) => (
          <div className="tile" key={name}>
            <div className="th"><span className="ico-tile"><Icon name={icon} small /></span><b>{name}</b></div>
            <p>{where}</p>
            <button type="button" className="btn sm" disabled title={GET_IT_OFF}>Get it</button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
