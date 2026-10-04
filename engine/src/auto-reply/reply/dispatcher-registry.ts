/**
 * Global registry for tracking active reply dispatchers.
 * Used to ensure gateway restart waits for all replies to complete.
 */
import { captureGatewayWorkOwnershipScope } from "../../process/gateway-work-admission.js";
import {
  isGatewayWorkOwnedBy,
  type GatewayWorkOwnershipScope,
  type SelectedRunWorkIdentity,
} from "../../process/gateway-work-ownership.js";
import { resolveGlobalSet } from "../../shared/global-singleton.js";

type TrackedDispatcher = {
  readonly pending: () => number;
  readonly workOwnership?: GatewayWorkOwnershipScope;
};

const activeDispatchers = resolveGlobalSet<TrackedDispatcher>(
  Symbol.for("branch.activeReplyDispatchers"),
  "close-only",
);

/**
 * Register a reply dispatcher for global tracking.
 * Returns an unregister function to call when the dispatcher is no longer needed.
 */
export function registerDispatcher(pending: () => number): () => void {
  // Separate registrations must remain distinct even when they share a callback.
  const tracked: TrackedDispatcher = { pending, workOwnership: captureGatewayWorkOwnershipScope() };
  activeDispatchers.add(tracked);

  return () => {
    activeDispatchers.delete(tracked);
  };
}

/**
 * Get the total number of pending replies across all dispatchers.
 */
export function getTotalPendingReplies(): number {
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    total += dispatcher.pending();
  }
  return total;
}

/** Counts only host-scoped current reservations; caller payloads grant no ownership. */
export function countPendingRepliesOwnedBy(selected: SelectedRunWorkIdentity): number {
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    if (isGatewayWorkOwnedBy(dispatcher.workOwnership, selected)) {
      total += dispatcher.pending();
    }
  }
  return total;
}
