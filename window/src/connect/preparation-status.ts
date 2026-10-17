/**
 * How long one startup episode is waited out (PreparationRetry) before the window says it is taking long. An
 * agent database's startup inspection was seen to take about 95 s after an update; two minutes covers that.
 */
export const PREPARATION_TIMEOUT_MS = 120_000;

/** The open Trunk is refusing because it is still getting ready: what the engine said, and whether the window stopped waiting. */
export type StartupWait = { detail: string; stalled: boolean };

/** Shown while `chat.history` is refused with UNAVAILABLE and the window is asking again. */
export const HISTORY_STARTING_LABEL = "Still starting up…";

/** How long one `chat.history` UNAVAILABLE episode is retried before the window stops and says what to do. */
export const HISTORY_RETRY_TIMEOUT_MS = 60_000;

/** After HISTORY_RETRY_TIMEOUT_MS: what went wrong and what to do, never the engine's words. */
export const HISTORY_UNAVAILABLE_LABEL =
  "Branch couldn’t load this chat’s history. Restart Branch, or check that the engine is running.";

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

/**
 * `chat.history` is not ready yet: the engine's retryable UNAVAILABLE for that method (details.method, as
 * respondChatHistoryUnavailable sends it), or session storage facts that have not settled. The structured
 * agent-database startup refusal stays `isStartupUnavailable`.
 */
export function isHistoryTemporarilyUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message === HISTORY_STARTING_LABEL) return true;
  if (/session access facts are unavailable|retry after session storage is ready/i.test(message)) return true;
  if (!error || typeof error !== "object" || isStartupUnavailable(error)) return false;
  const shaped = error as { gatewayCode?: unknown; code?: unknown; retryable?: unknown; details?: unknown };
  if ((shaped.gatewayCode ?? shaped.code) !== "UNAVAILABLE") return false;
  const details = shaped.details && typeof shaped.details === "object" ? shaped.details as { method?: unknown } : {};
  return shaped.retryable === true || details.method === "chat.history" || details.method === "chat.startup";
}

/** Startup admission is temporary; keep engine/doctor wording out of the conversation. */
export function isPreparationPending(error: unknown): boolean {
  if (isHistoryTemporarilyUnavailable(error)) return true;
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

/**
 * A single startup episode gets at most two minutes of increasingly spaced retries.
 * `chat.history` UNAVAILABLE uses a one-minute episode (`HISTORY_RETRY_TIMEOUT_MS`).
 */
export class PreparationRetry {
  private startedAt: number | null = null;
  private attempts = 0;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = PREPARATION_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  nextDelay(now = Date.now()): number | null {
    if (this.startedAt === null) this.startedAt = now;
    const remaining = this.timeoutMs - (now - this.startedAt);
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
