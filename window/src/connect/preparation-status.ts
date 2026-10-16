/**
 * How long one startup episode is waited out (PreparationRetry) before the window says it is taking long. An
 * agent database's startup inspection was seen to take about 95 s after an update; two minutes covers that.
 */
export const PREPARATION_TIMEOUT_MS = 120_000;

/** The open Trunk is refusing because it is still getting ready: what the engine said, and whether the window stopped waiting. */
export type StartupWait = { detail: string; stalled: boolean };

/**
 * The engine's structured "not ready yet" refusal (ErrorCodes.UNAVAILABLE), read from its code and details rather
 * than its words: an agent database still in startup inspection and preparation (details.code, see the engine's
 * createAgentDatabaseAdmissionErrorShape), or a method the Gateway has not registered yet while it starts
 * (details.reason "startup-sidecars", gateway-protocol startup-unavailable.ts).
 */
export function isStartupUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const shaped = error as { gatewayCode?: unknown; code?: unknown; details?: unknown };
  if ((shaped.gatewayCode ?? shaped.code) !== "UNAVAILABLE") return false;
  const details = shaped.details && typeof shaped.details === "object" ? shaped.details as { code?: unknown; reason?: unknown } : {};
  return details.code === "agent-database-inspection-pending" || details.reason === "startup-sidecars";
}

/** Startup admission is temporary; keep engine/doctor wording out of the conversation. */
export function isPreparationPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /has not completed startup inspection and preparation|agent database startup preparation|prepared model runtime publication was superseded|prepared reply dispatch runtime owner was not published|unavailable during gateway startup|Model catalog is not ready/i.test(message);
}

export function preparationLabel(name: string): string {
  return `Getting ${name || "this Trunk"} ready…`;
}

/** After PREPARATION_TIMEOUT_MS, in plain words: no engine terms and no command to type. */
export function preparationSlowLabel(name: string): string {
  return `${name || "This Trunk"} is taking longer than usual to get ready.`;
}

export function preparationTimeoutLabel(name: string): string {
  return `${name || "This Trunk"} is still starting up. Try again in a minute.`;
}

/** The window stopped re-reading after its two minutes (`preparationTimeoutLabel`); the Trunk may still be getting ready. */
export function isPreparationStalled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.endsWith("is still starting up. Try again in a minute.");
}

export function preparationRetryingLabel(name: string): string {
  return `Getting ${name || "this Trunk"} ready failed, retrying…`;
}

/** The engine stopped retrying after five failed starts in a row; only Retry starts it again. */
export function preparationNeedsAttentionLabel(name: string): string {
  return `${name || "This Trunk"} needs attention: getting it ready kept failing.`;
}

/** A single startup episode gets at most two minutes of increasingly spaced retries. */
export class PreparationRetry {
  private startedAt: number | null = null;
  private attempts = 0;

  nextDelay(now = Date.now()): number | null {
    if (this.startedAt === null) this.startedAt = now;
    const remaining = PREPARATION_TIMEOUT_MS - (now - this.startedAt);
    if (remaining <= 0) return null;
    const delay = Math.min(500 * 2 ** this.attempts, 5_000, remaining);
    this.attempts += 1;
    return delay;
  }

  reset(): void {
    this.startedAt = null;
    this.attempts = 0;
  }
}
