import { PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.errors.js";
import type {
  PreparedModelRuntimeOwner,
  PreparedModelRuntimeSnapshot,
} from "./prepared-model-runtime.types.js";

/**
 * A publication that a newer publication for the same owner superseded adopts that newer
 * snapshot, so its caller continues instead of failing the run that started it.
 */
export async function adoptSupersedingPublication(
  owners: Map<string, PreparedModelRuntimeOwner>,
  key: string,
  error: unknown,
): Promise<PreparedModelRuntimeSnapshot> {
  if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
    throw error;
  }
  for (let pending = owners.get(key)?.pending; pending; pending = owners.get(key)?.pending) {
    await pending.catch(() => undefined);
  }
  const successor = owners.get(key)?.snapshot;
  if (successor?.isCurrent()) {
    return successor;
  }
  throw error;
}
