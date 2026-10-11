import { requestSignalSessionEventWake } from "../session-event-wake.js";

type SignalWakeRequest = Parameters<typeof requestSignalSessionEventWake>[0];

/**
 * The one entry that may send a signal wake. Only the signal dispatch imports it. A static test pins
 * the importers, and the session-event enqueue point refuses `signal` from every other caller.
 */
export function requestSignalWake(options: SignalWakeRequest): void {
  requestSignalSessionEventWake(options);
}
