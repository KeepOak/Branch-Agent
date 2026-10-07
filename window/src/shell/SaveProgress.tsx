// "Offer to save progress at 95%" (the preview's checkpointPrompt): when a measured limit window is 95% used, ask once
// per connection per window whether running tasks should save their progress. "Save progress" steers each running
// conversation with chat.send (queueMode "steer", as the Canopy run card does); nothing is paused. The switch is the
// look pref "usage.ckpt" (on unless turned off); Settings › Data & usage › "Show me" asks at once with the real figures.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Limits } from "./status-data";
import { notify } from "./notify";
import { lookStore } from "../places/settings/set1/appearance-store";

export const CKPT_PREF = "usage.ckpt";
export const CKPT_SHOW = "branch:ckpt-show";
const ASKED = "branch.ckpt.asked";
const TOTAL_MS = 5000;
export const SAVE_TEXT = "Save your progress now: write down what is done, where you are and what comes next, so nothing is lost if the usage limit is reached. Then carry on.";

/** The "Offer to save progress at 95%" switch: on unless the person turned it off. */
export function useCkptOn(engine: WindowEngine): boolean {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  return look[CKPT_PREF] !== false;
}

export type Almost = { key: string; name: string; account: string; window: string; used: number; example?: boolean };

/** The measured window with the least left, if it has `atMost`% or less left (5 = the 95% offer), or null. */
export function almostOut(limits: Limits | null, atMost = 5): Almost | null {
  let best: Almost | null = null;
  for (const row of limits?.rows ?? []) {
    for (const w of row.windows) {
      if (w.left <= atMost && (!best || 100 - w.left > best.used)) best = { key: `${row.id}|${w.name}|${w.reset}`, name: row.name, account: row.account, window: w.name, used: 100 - w.left };
    }
  }
  return best;
}

function asked(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ASKED) ?? "[]") as string[]; } catch { return []; }
}
function markAsked(key: string) {
  try { sessionStorage.setItem(ASKED, JSON.stringify([...asked(), key])); } catch { /* storage blocked: it may ask again */ }
}

/** Steers every running conversation to save its progress; returns how many were asked. */
export async function askToSave(engine: WindowEngine, keys: string[]): Promise<number> {
  const sent = await Promise.allSettled(keys.map((sessionKey) => engine.request("chat.send", { sessionKey, message: SAVE_TEXT, queueMode: "steer", idempotencyKey: crypto.randomUUID() })));
  return sent.filter((r) => r.status === "fulfilled").length;
}

export function SaveProgressOffer({ engine, limits, on, runningKeys }: { engine: WindowEngine; limits: Limits | null; on: boolean; runningKeys: string[] }) {
  const [shown, setShown] = useState<Almost | null>(null);
  const [left, setLeft] = useState(TOTAL_MS);
  const near = almostOut(limits);
  useEffect(() => {
    if (on && near && !asked().includes(near.key)) { markAsked(near.key); setShown(near); }
  }, [on, near?.key]);
  useEffect(() => {
    const show = () => setShown(almostOut(limits, 100) ?? { key: "example", name: "a connection", account: "", window: "5-hour", used: 95, example: true });
    window.addEventListener(CKPT_SHOW, show);
    return () => window.removeEventListener(CKPT_SHOW, show);
  }, [limits]);
  useEffect(() => {
    if (!shown) return;
    const t0 = Date.now();
    setLeft(TOTAL_MS);
    const id = window.setInterval(() => { const l = Math.max(0, TOTAL_MS - (Date.now() - t0)); setLeft(l); if (!l) setShown(null); }, 100);
    return () => window.clearInterval(id);
  }, [shown]);
  if (!shown) return null;
  const save = async () => {
    setShown(null);
    const n = await askToSave(engine, runningKeys);
    notify(n ? `Asked ${n} running task${n === 1 ? "" : "s"} to save progress. Nothing was paused.` : "Nothing is running, so there is no progress to save.");
  };
  return (
    <div className="ckpt-q" role="alertdialog" aria-label="Save progress?">
      <svg className="ck-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--line-2)" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="94.2" strokeDashoffset={94.2 * (1 - left / TOTAL_MS)} transform="rotate(-90 18 18)" />
        <text x="18" y="22" textAnchor="middle" fontSize="12" fill="var(--ink-2)">{Math.ceil(left / 1000)}</text>
      </svg>
      <div className="grow">
        <b>Almost out on {shown.name}{shown.account ? ` (${shown.account})` : ""}. Ask running tasks to save their progress?</b>
        <small>{shown.example ? "Example: " : ""}{shown.used}% of {/^this /i.test(shown.window) ? shown.window.toLowerCase() : `the ${shown.window.toLowerCase()} window`} is used. {shown.example ? "No measured limit is available." : "Measured."} Nothing is paused.</small>
      </div>
      <button className="btn pri sm" type="button" disabled={shown.example} title={shown.example ? "This is an example; no measured limit is near 95%." : undefined} onClick={() => void save()}>Save progress</button>
      <button className="btn ghost sm" type="button" onClick={() => setShown(null)}>Not now</button>
    </div>
  );
}
