// Skeleton rows while something loads, and a deadline after which a scan says how it ended (DA-106).
import { useEffect, useState } from "react";
import "./skeleton.css";

/** Grey rows in the shape of the list that is coming; the words stay for screen readers only. */
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="skel-rows" role="status" aria-busy="true" data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel-row" aria-hidden="true">
          <span className="skel-dot" />
          <span className="skel-lines">
            <span className="skel-line" />
            <span className="skel-line short" />
          </span>
        </div>
      ))}
      <span className="skel-label">{label}</span>
    </div>
  );
}

/** A grey screen while a computer's screen connects. */
export function SkeletonScreen({ label }: { label: string }) {
  return (
    <div className="skel-screen" role="status" aria-busy="true" data-testid="skeleton">
      <span className="skel-bar" aria-hidden="true" />
      <span className="skel-block" aria-hidden="true" />
      <span className="skel-label">{label}</span>
    </div>
  );
}

/**
 * True once `active` has stayed true for `ms` without `attempt` changing, so a scan that never answers ends
 * with a result instead of loading forever. A new attempt starts the clock again.
 */
export function useDeadline(active: boolean, ms: number, attempt: unknown = 0): boolean {
  const [over, setOver] = useState<unknown>(undefined);
  const key = `${String(attempt)}`;
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setOver(key), ms);
    return () => clearTimeout(timer);
  }, [active, ms, key]);
  return active && over === key;
}
