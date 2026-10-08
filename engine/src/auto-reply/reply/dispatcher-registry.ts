/**
 * Global registry for tracking active reply dispatchers.
 * Used to ensure gateway restart waits for all replies to complete.
 */
import { resolveGlobalSet } from "../../shared/global-singleton.js";
import {
  countLiveReplyOperations,
  hasRetainedNonLiveReplyOperation,
} from "./reply-run-registry.state.js";

type TrackedDispatcher = {
  readonly pending: () => number;
  readonly isReservationOnly: () => boolean;
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
): () => void {
  // Separate registrations must remain distinct even when they share a callback.
  const tracked: TrackedDispatcher = {
    pending,
    isReservationOnly: isReservationOnly ?? (() => false),
  };
  activeDispatchers.add(tracked);

  return () => {
    activeDispatchers.delete(tracked);
  };
}

/**
 * Get the total number of pending replies across all dispatchers.
 * Leftover start reservations are ignored when every retained reply owner is already dead.
 */
export function getTotalPendingReplies(): number {
  const liveOwners = countLiveReplyOperations();
  const leftoverReservations =
    hasRetainedNonLiveReplyOperation() && liveOwners === 0;
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    if (leftoverReservations && dispatcher.isReservationOnly?.()) {
      continue;
    }
    total += dispatcher.pending();
  }
  return total;
}
