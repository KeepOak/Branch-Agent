/**
 * Global registry for tracking active reply dispatchers.
 * Used to ensure gateway restart waits for all replies to complete.
 */
import { resolveGlobalSet } from "../../shared/global-singleton.js";
import {
  isLiveReplyOperation,
  replyRunState,
} from "./reply-run-registry.state.js";

type TrackedDispatcher = {
  readonly pending: () => number;
  readonly isReservationOnly: () => boolean;
  readonly ownerKey: () => string | undefined;
};

const activeDispatchers = resolveGlobalSet<TrackedDispatcher>(
  Symbol.for("branch.activeReplyDispatchers"),
  "close-only",
);

/**
 * Register a reply dispatcher for global tracking.
 * Returns an unregister function to call when the dispatcher is no longer needed.
 */
export function registerDispatcher(
  pending: () => number,
  isReservationOnly?: () => boolean,
  ownerKey?: () => string | undefined,
): () => void {
  // Separate registrations must remain distinct even when they share a callback.
  const tracked: TrackedDispatcher = {
    pending,
    isReservationOnly: isReservationOnly ?? (() => false),
    ownerKey: ownerKey ?? (() => undefined),
  };
  activeDispatchers.add(tracked);

  return () => {
    activeDispatchers.delete(tracked);
  };
}

function isDeadOwnerLeftoverReservation(dispatcher: TrackedDispatcher): boolean {
  const ownerKey = dispatcher.ownerKey?.();
  if (!ownerKey) {
    return false;
  }
  const owner = replyRunState.activeRunsByKey.get(ownerKey);
  if (!owner || isLiveReplyOperation(owner)) {
    return false;
  }
  // Start reservations and leftover pending===1 after enqueue both stick when
  // queuedCounts never decrements. Skip only this dead owner's dispatcher.
  return dispatcher.isReservationOnly?.() === true || dispatcher.pending() === 1;
}

/**
 * Get the total number of pending replies across all dispatchers.
 * Leftover reservations count as 0 only for the dead owner's own dispatcher.
 */
export function getTotalPendingReplies(): number {
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    if (isDeadOwnerLeftoverReservation(dispatcher)) {
      continue;
    }
    total += dispatcher.pending();
  }
  return total;
}
