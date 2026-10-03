// One test for "can this approval still be answered this way": not yet decided, not expired, and the decision is one
// the request allows. The two-approval group card and the call's spoken ask both use it where they draw their buttons
// and again where they send the answer, so a stale screen never forwards an expired id or a decision it may not make.
import { useEffect, useState } from "react";
import type { ApprovalDecision } from "./model";
import type { ApprovalDetails } from "./useEngineData";

const EVERY: readonly ApprovalDecision[] = ["allow-once", "allow-always", "deny"];

/** Still waiting: no decision has arrived and it hasn't expired. Without details (an exec card from history) it counts as waiting. */
export function isCurrent(d: ApprovalDetails | undefined, now: number = Date.now()): boolean {
  return !d || (!d.decision && (!d.expiresAtMs || d.expiresAtMs > now));
}

/** Waiting, and `decision` is one of the request's allowedDecisions. */
export function canAnswer(d: ApprovalDetails | undefined, decision: ApprovalDecision, now: number = Date.now()): boolean {
  return isCurrent(d, now) && (d?.allowedDecisions ?? EVERY).includes(decision);
}

/** The time, ticking each second while `active`, so a card's buttons go when its request expires. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
