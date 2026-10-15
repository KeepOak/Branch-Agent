// The 3-in-1 ring (HANDOFF §2 #14, preview ringP17/ringSvgP17): the outer arc is the tightest account window, the inner
// arc the context used here, and the badge counts what is running. A share the engine hasn't reported draws no arc.
import { forwardRef } from "react";

/** The preview's pctCol: --bad from 95%, --warn from 80%, else the button's own colour. */
export function ringColour(percent: number): string {
  return percent >= 95 ? "var(--bad)" : percent >= 80 ? "var(--warn)" : "currentColor";
}

/** stroke-dasharray for a share of a circle, never thinner than the preview's 2% minimum. */
export function arc(radius: number, percent: number): string {
  const c = 2 * Math.PI * radius;
  return `${(c * Math.max(Math.min(percent, 100), 2) / 100).toFixed(1)} ${c.toFixed(1)}`;
}

export type RingProps = {
  /** 0–100: the highest 5-hour or weekly use across accounts; null when no account reports one. */
  usage: number | null;
  /** 0–100: context used in this conversation; null before the engine measures it. */
  context: number | null;
  running: number;
  /** The whole summary, read aloud and shown as the tooltip. */
  label: string;
  open?: boolean;
  onOpen: () => void;
};

export const Ring = forwardRef<HTMLButtonElement, RingProps>(function Ring({ usage, context, running, label, open, onOpen }, ref) {
  return <button ref={ref} type="button" className="g-ring" data-local="" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}. Open usage, running and context`} title={label} onClick={onOpen}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="2" />
      {usage === null ? null : <circle data-arc="usage" cx="12" cy="12" r="10" fill="none" stroke={ringColour(usage)} strokeWidth="2" strokeLinecap="round" transform="rotate(-90 12 12)" strokeDasharray={arc(10, usage)} />}
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="2" />
      {context === null ? null : <circle data-arc="context" cx="12" cy="12" r="5.5" fill="none" stroke={ringColour(context)} strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" transform="rotate(-90 12 12)" strokeDasharray={arc(5.5, context)} />}
    </svg>
    {running > 0 ? <span className="g-ring-n">{running}</span> : null}
  </button>;
});
