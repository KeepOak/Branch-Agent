import {
  startParentWatchdog,
  type ParentWatchdogOptions,
} from "../../process/parent-watchdog.ts";

/** Bind parent loss to the run loop's existing graceful stop and drain owner. */
export function installGatewayParentWatchdog(
  requestStop: (reason: string) => void,
  options: ParentWatchdogOptions = {},
): () => void {
  return startParentWatchdog(() => requestStop("parent process gone"), undefined, options);
}
