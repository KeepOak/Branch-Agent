import type { CanopyLifecycle } from "./types.ts";

export type CardSessionState = CanopyLifecycle["state"] | "cancelled" | "timed_out" | "stopped";

export function getCardSessionState(lifecycle: CanopyLifecycle): CardSessionState {
  if (lifecycle.state === "failed") {
    if (lifecycle.session?.status === "timeout") {
      return "timed_out";
    }
    if (lifecycle.session?.status === "killed" || lifecycle.session?.abortedLastRun) {
      return "stopped";
    }
  }
  return lifecycle.state;
}
