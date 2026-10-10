// Host-side relay for a joined Branch: messages it sends to this Branch's Trunks run here, and each reply waits for
// the joined Branch to poll it over the socket that Branch opened. Nothing dials the joined Branch.
// Slice 1 keeps this in memory; the design (docs in the PR body) makes it durable and acked across reconnects.

/** Most relayed messages one joined Branch may have running at once. */
export const RELAY_MAX_IN_FLIGHT = 8;
/** Most unacknowledged replies held for one joined Branch. */
export const RELAY_MAX_REPLIES = 64;

export type RelayReply = { id: string; reply?: string; error?: string };

const inFlight = new Map<string, number>();
const replies = new Map<string, RelayReply[]>();

/** Reserves one running slot for this device, or says why it cannot take more work now. */
export function beginRelay(deviceId: string): { ok: true } | { ok: false; message: string } {
  const running = inFlight.get(deviceId) ?? 0;
  if (running >= RELAY_MAX_IN_FLIGHT) {
    return { ok: false, message: "That Branch already has too many messages running. Try again when one finishes." };
  }
  inFlight.set(deviceId, running + 1);
  return { ok: true };
}

/** Records the outcome and frees the slot. A full reply queue refuses to hold more; the send already ran. */
export function finishRelay(deviceId: string, reply: RelayReply): void {
  inFlight.set(deviceId, Math.max(0, (inFlight.get(deviceId) ?? 1) - 1));
  const queue = replies.get(deviceId) ?? [];
  if (queue.length >= RELAY_MAX_REPLIES) queue.shift();
  queue.push(reply);
  replies.set(deviceId, queue);
}

/** Replies not yet acknowledged by this device, oldest first. Polling does not remove them. */
export function pollRelays(deviceId: string): RelayReply[] {
  return [...(replies.get(deviceId) ?? [])];
}

/** The device acknowledged a reply; it is removed so it is never delivered twice. */
export function ackRelay(deviceId: string, id: string): boolean {
  const queue = replies.get(deviceId) ?? [];
  const next = queue.filter((row) => row.id !== id);
  replies.set(deviceId, next);
  return next.length !== queue.length;
}

/** Test support: forget every running count and reply. */
export function resetRelayState(): void {
  inFlight.clear();
  replies.clear();
}
