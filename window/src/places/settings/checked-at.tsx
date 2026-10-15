// A check button's result line. A check that finds nothing new still ends with a visible "Checked at" time, so the
// button never looks like it did nothing.
import { useState, type ReactNode } from "react";

/** The time the last check finished (null until one has), and a function that stamps it now. */
export function useCheckedAt(): [number | null, () => void] {
  const [at, setAt] = useState<number | null>(null);
  return [at, () => setAt(Date.now())];
}

export function CheckedAt({ at }: { at: number | null }) {
  if (at === null) return null;
  const time = new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return <small className="g-label checked-at" role="status">{`Checked at ${time}`}</small>;
}

/** A button that runs a check and then shows its time. `run` resolves true only when the check succeeded (a failed
 *  read resolves false, with its error on the page), so a failure never shows a Checked at time. */
export function CheckButton({ run, className = "r1s-btn", disabled, title, children, ...rest }: {
  run: () => Promise<boolean>; className?: string; disabled?: boolean; title?: string; children: ReactNode; "data-local"?: string;
}) {
  const [at, stamp] = useCheckedAt();
  const onClick = () => void run().then((ok) => { if (ok) stamp(); }, () => undefined);
  return <>
    <button type="button" className={className} disabled={disabled} title={title} {...rest} onClick={onClick}>{children}</button>
    <CheckedAt at={at} />
  </>;
}
