// How a chat.send (or a read) failed, as the gateway client reports it: the engine answered with a refusal (it carries
// its gateway code), the request never left this window ("gateway not connected"), or the connection went after it
// left (`gateway closed`, a local timeout), when the engine may or may not have it.

/** The message never left this window. */
export const isNotConnected = (error: unknown): boolean => error instanceof Error && error.message === "gateway not connected";

/** The engine answered the request (a refusal carries its gateway code), or the message never left this window.
 *  A connection that closed after the request left is neither. */
export function refusedOrUnsent(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return typeof (error as { gatewayCode?: unknown }).gatewayCode === "string" || error.message === "gateway not connected";
}

/** A refusal the engine says to ask again after a moment (`retryable`: busy, or a session held by an engine handing
 *  over, `session-handoff-lease`): never Not sent. */
export function isRetryable(error: unknown): boolean {
  const e = error as { gatewayCode?: unknown; retryable?: unknown } | null;
  return Boolean(e && typeof e.gatewayCode === "string" && e.retryable === true);
}

/** The engine said no for good: not retryable, and not a connection that went. */
export function firmRefusal(error: unknown): boolean {
  return refusedOrUnsent(error) && !isNotConnected(error) && !isRetryable(error);
}

/** A refusal the engine marks retryable (`retryable`, `retryAfterMs`: it is busy for a moment) is asked again, with
 *  the same idempotency key, before the message counts as Not sent. */
export async function requestWithRetry<T>(send: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const e = error as { retryAfterMs?: unknown };
      if (attempt >= tries || !isRetryable(error)) throw error;
      // The engine's own wait (5 s while a handoff lease holds the conversation), within reason.
      await new Promise((resolve) => setTimeout(resolve, typeof e.retryAfterMs === "number" ? Math.min(e.retryAfterMs, 5_000) : 250));
    }
  }
}

/** A chat.send answer that means no run will report (anything but started, in_flight or ok): its reason, else null. */
export function failedAck(result: Record<string, unknown>): string | null {
  const status = typeof result.status === "string" ? result.status : "";
  if (!status || ["started", "in_flight", "ok"].includes(status)) return null;
  const said = [result.summary, result.error].find((v): v is string => typeof v === "string" && v.length > 0);
  return said ?? `The engine answered "${status}".`;
}
