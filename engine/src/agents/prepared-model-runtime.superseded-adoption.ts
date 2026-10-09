import { PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.errors.js";
import { hasSameLifecycleInput, ownerKey } from "./prepared-model-runtime.owner.js";
import type {
  PreparedModelRuntimeInput,
  PreparedModelRuntimeOwner,
  PreparedModelRuntimeSnapshot,
} from "./prepared-model-runtime.types.js";

/** Upper bound on pending publications one superseded caller waits for. */
const MAX_ADOPTION_WAITS = 16;

/**
 * A publication that a newer publication for the same owner superseded adopts that newer
 * snapshot, but only when that snapshot was built for the caller's own input. Otherwise the
 * original superseded error is rethrown.
 */
export async function adoptSupersedingPublication(
  owners: Map<string, PreparedModelRuntimeOwner>,
  input: PreparedModelRuntimeInput,
  error: unknown,
): Promise<PreparedModelRuntimeSnapshot> {
  if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
    throw error;
  }
  const key = ownerKey(input);
  let waitedFor: Promise<unknown> | undefined;
  for (let waits = 0; waits < MAX_ADOPTION_WAITS; waits += 1) {
    const pending = owners.get(key)?.pending;
    // A settled promise can stay installed; waiting on it again would spin.
    if (!pending || pending === waitedFor) {
      break;
    }
    waitedFor = pending;
    await pending.catch(() => undefined);
  }
  const successor = owners.get(key);
  if (successor?.snapshot?.isCurrent() && hasSameLifecycleInput(successor.input, input)) {
    return successor.snapshot;
  }
  throw error;
}
