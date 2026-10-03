// The recommendation bar above Overview and Inbox (preview recBar + 40-places §4.6.2.0): a line icon on a
// --brand-tint tile, the question, "Recommended", and Yes / Not now / Don't ask again.
import { useSyncExternalStore } from "react";

const KEY = "branch.rec.keepRunning";
export const KEEP_RUNNING_GAP = "Needs the engine's keep-running service method (install the Gateway as a background service).";

let dismissed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

function readNever(): boolean {
  try {
    return localStorage.getItem(KEY) === "never";
  } catch (error) {
    console.warn("Could not read the recommendation choice", error);
    return false;
  }
}

/** Not now hides the bar until the window opens again; Don't ask again keeps it hidden. */
export function hideRecommendation(forever: boolean): void {
  dismissed = true;
  if (forever) {
    try {
      localStorage.setItem(KEY, "never");
    } catch (error) {
      console.warn("Could not save the recommendation choice", error);
    }
  }
  changed();
}

/** Test seam: forget this window's Not now. */
export function resetRecommendation(): void {
  dismissed = false;
  changed();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
const hidden = () => dismissed || readNever();

export function RecBar() {
  const isHidden = useSyncExternalStore(subscribe, hidden);
  if (isHidden) return null;
  return (
    <div className="ov-rec" role="region" aria-label="Recommendation">
      <span className="ov-rec-tile" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6" /></svg>
      </span>
      <span className="ov-rec-t">
        <b>Keep your Trunks running when Branch is closed?</b><span className="ov-rec-good">Recommended</span>
        <small>The gateway keeps Telegram, your phone and automations working, and restarts Branch if it ever stops.</small>
      </span>
      <button type="button" className="btn pri sm" disabled title={KEEP_RUNNING_GAP}>Yes</button>
      <button type="button" className="btn sm" onClick={() => hideRecommendation(false)}>Not now</button>
      <button type="button" className="btn ghost sm" onClick={() => hideRecommendation(true)}>Don’t ask again</button>
    </div>
  );
}
