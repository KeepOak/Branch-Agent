/** Shown when the phone cannot reach the computer. Never the engine's or Java's own text. */
export const CANT_REACH_BRANCH = "Can't reach Branch. Check your connection.";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function errorCode(error: unknown): string {
  return str(rec(error).gatewayCode) || str(rec(error).code);
}

export function isMissingScope(error: unknown): boolean {
  return errorCode(error) === 'FORBIDDEN' || str(rec(rec(error).details).code) === 'MISSING_SCOPE';
}

/** Plain words for a failed list/read. Never error.message, String(err), a stack, or java.* text. */
export function loadFailure(error: unknown, fallback = CANT_REACH_BRANCH): string {
  if (isMissingScope(error)) return 'This phone isn’t allowed to see this any more. Pair it again from Branch on your computer.';
  if (errorCode(error) === 'UNAVAILABLE') return CANT_REACH_BRANCH;
  return fallback;
}
