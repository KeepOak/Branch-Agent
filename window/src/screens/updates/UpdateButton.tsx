// The R1 sidebar update button and the avatar-menu update banner (HANDOFF R1-11 "Update UI"). Both read one
// UpdateFlow, so they never disagree, and neither is rendered while there is no update.
import { useEffect, useRef, useState } from "react";
import { updateCopy, type UpdateView } from "./model";
import type { UpdateFlow } from "./useUpdateFlow";
import "./updates.css";

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const CloudDown = () => <svg {...svg} width={18} height={18}><path d="M7 17.5a4.5 4.5 0 0 1-.4-8.98A5.5 5.5 0 0 1 17.3 9.6 4 4 0 0 1 17 17.5" /><path d="M12 11v8M9 16l3 3 3-3" /></svg>;
const Ring = () => <svg className="r1u-ring" width={22} height={22} viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" strokeWidth="2.2" className="r1u-ring-track" /><circle cx="11" cy="11" r="9" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="14 57" className="r1u-ring-arc" /></svg>;

/** The exit animation's length in updates.css (.r1u-btn[data-leaving]). */
export const EXIT_MS = 240;
/** Keeps the last real view on screen while the button plays its exit (--ease-exit), then removes it. */
function useExit(view: UpdateView): { shown: UpdateView | null; leaving: boolean } {
  const last = useRef<UpdateView | null>(view.kind === "none" ? null : view);
  const [leaving, setLeaving] = useState(false);
  if (view.kind !== "none") last.current = view;
  useEffect(() => {
    if (view.kind !== "none" || !last.current) { setLeaving(false); return; }
    setLeaving(true);
    const timer = setTimeout(() => { last.current = null; setLeaving(false); }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [view.kind]);
  return { shown: view.kind === "none" ? (leaving ? last.current : null) : view, leaving };
}

/** 36 px disc in the sidebar bottom row: Install → ring while it works → "Restart Branch" → "Updated to X", then it leaves. */
export function UpdateButton({ flow, rail }: { flow: UpdateFlow; rail?: boolean }) {
  const { shown, leaving } = useExit(flow.view);
  if (!shown) return null;
  const copy = updateCopy(shown), busy = shown.kind === "installing" || shown.kind === "restarting";
  const wide = !rail && (shown.kind === "restart" || shown.kind === "done");
  if (shown.kind === "done") return <span className="r1u-btn" data-kind="done" data-wide={wide || undefined} data-leaving={leaving || undefined} role="status" title={copy.tip}>
    {rail ? <span aria-hidden="true">✓</span> : null}<span className={rail ? "r1u-sr" : "r1u-label"}>{copy.label}</span>
  </span>;
  return <button type="button" className="r1u-btn" data-kind={shown.kind} data-wide={wide || undefined} data-leaving={leaving || undefined} title={copy.tip}
    aria-label={shown.kind === "failed" ? `Try again: ${copy.tip}` : shown.kind === "restart" ? "Restart Branch" : copy.tip} aria-busy={busy || undefined}
    disabled={busy || leaving} onClick={flow.act}>
    {busy ? <Ring /> : shown.kind === "restart" ? (rail ? <span aria-hidden="true">↻</span> : <span className="r1u-label">{copy.label}</span>) : shown.kind === "failed" ? <span aria-hidden="true">!</span> : <CloudDown />}
    {busy ? <span className="r1u-sr" role="status">{copy.tip}</span> : null}
  </button>;
}

/** The avatar menu's first row while an update exists: the line on a tinted pill and one white action pill. */
export function UpdateBanner({ flow, onAction }: { flow: UpdateFlow; onAction?: () => void }) {
  if (flow.view.kind === "none") return null;
  const copy = updateCopy(flow.view);
  return <div className="r1u-ban" role="group" aria-label="Update" data-kind={flow.view.kind}>
    <span className="r1u-ban-text" title={copy.tip}>{copy.banner}</span>
    {copy.action ? <button type="button" className="r1u-ban-act" onClick={() => { onAction?.(); flow.act(); }}>{copy.action}</button> : null}
  </div>;
}
