// The refusals a process gets when the shared state belongs to another owner: a handoff successor took it, or
// maintenance holds it. Kept dependency-free so run-outcome classifiers can match them.

/** This process may not use the state while another owner (a handoff successor or maintenance) holds it. */
export function formatStateOfflineMaintenanceMessage(databasePath: string): string {
  return `Branch Agent state at ${databasePath} is undergoing offline maintenance; retry when it finishes.`;
}

/** This process could not confirm it still owns the state. */
export function formatStateOwnershipUnverifiedMessage(databasePath: string): string {
  return `Branch Agent state ownership at ${databasePath} could not be verified; retry after maintenance finishes.`;
}

const GATEWAY_STATE_UNAVAILABLE_RE =
  /Branch Agent state (?:ownership )?at .+? (?:is undergoing offline maintenance; retry when it finishes|could not be verified; retry after maintenance finishes)\./;

/**
 * Whether a failure is one of the refusals above: the state now belongs to another owner, so the work was cut off
 * rather than failing on its own. Matches the text form too: run outcomes cross process and storage boundaries as
 * strings.
 */
export function isGatewayStateUnavailableMessage(text: string): boolean {
  return GATEWAY_STATE_UNAVAILABLE_RE.test(text);
}
