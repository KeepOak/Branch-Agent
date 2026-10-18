/** Plain copy when Graft or MCP serve cannot reach the engine after retries. */
export const MCP_GATEWAY_UNREACHABLE = "Couldn't reach Branch's engine. Restart Branch.";

/** Closes before hello that Graft waits through. The Gateway client already reconnects with backoff. */
export const MCP_GATEWAY_CLOSE_BEFORE_READY_RETRIES = 3;

const CLOSED_BEFORE_READY_RE =
  /closed before ready|gateway transient pre-hello|gateway closed\s*\(/i;

/** True when a connect failed only because the Gateway socket closed before hello. */
export function isGatewayClosedBeforeReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return CLOSED_BEFORE_READY_RE.test(message);
}

/** Friendly line for a close-before-ready failure, or null when the caller should keep its own wrapping. */
export function plainGatewayStartFailure(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message === MCP_GATEWAY_UNREACHABLE || isGatewayClosedBeforeReadyError(error)) {
    return MCP_GATEWAY_UNREACHABLE;
  }
  return null;
}
