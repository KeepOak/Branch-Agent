/** Startup admission is temporary; keep engine/doctor wording out of the conversation. */
export function isPreparationPending(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /has not completed startup inspection and preparation|agent database startup preparation|prepared model runtime publication was superseded|prepared reply dispatch runtime owner was not published|unavailable during gateway startup|Model catalog is not ready/i.test(message);
}

/**
 * Owner-facing text for a failed action, without a final period so the caller can add one.
 * An agent that is still starting gets one plain line; the engine's repair steps stay in logs.
 */
export function ownerErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (isPreparationPending(error)) {
    const id = /Agent ([\w.-]+) has not completed/.exec(message)?.[1];
    return id ? `${id.charAt(0).toUpperCase()}${id.slice(1)} is still starting up` : "Still starting up";
  }
  return message.replace(/[.\s]+$/, "");
}

export function preparationLabel(name: string): string {
  return `Getting ${name || "this Trunk"} ready…`;
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
    const remaining = 120_000 - (now - this.startedAt);
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
