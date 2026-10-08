import {
  startParentWatchdog,
  type ParentWatchdogOptions,
} from "../../process/parent-watchdog.ts";

/** Bind parent loss to the run loop's existing graceful stop and drain owner. */
export function installGatewayParentWatchdog(
  requestStop: () => void,
  options: ParentWatchdogOptions = {},
): () => void {
  return startParentWatchdog(requestStop, undefined, options);
}
