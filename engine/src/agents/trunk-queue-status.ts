// Small shared helpers for the Trunk queue: the recognised refusal of a Trunk that is not ready, and how a sweep reports
// a Trunk's availability (logged only when it changes).
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const message = rec(error).message;
  return typeof message === "string" ? message : String(error);
}

/** The structured reasons the gateway attaches while it restarts, suspends or starts (gateway-protocol). */
const GATEWAY_NOT_READY_REASONS = new Set([
  "gateway-restarting",
  "gateway-suspending",
  "startup-sidecars",
]);

/**
 * The same refusals once only their text is left: a run's lifecycle error is a string, so its code and details are
 * gone. Close codes 1001, 1012 and 1013 are a gateway going away, restarting, or asking to try again later.
 */
const GATEWAY_NOT_READY_TEXT = [
  /has not completed startup inspection/,
  /unavailable during gateway (?:startup|restart|suspension|shutdown)/,
  /gateway closed \((?:1001|1012|1013)\)/,
];

/**
 * Infrastructure, not the job: the gateway is restarting, suspending or starting, or the Trunk has not finished its
 * startup preparation. Such a refusal or run error never counts as a failed attempt; the job waits and is tried again
 * once the gateway and the Trunk are ready. Same split as the gateway's own retryable UNAVAILABLE errors.
 */
export function isRetryableInfrastructureError(error: unknown): boolean {
  const shape = rec(error);
  if (shape.gatewayCode === "UNAVAILABLE" || shape.code === "UNAVAILABLE") {
    return true;
  }
  const reason = rec(shape.details).reason;
  if (typeof reason === "string" && GATEWAY_NOT_READY_REASONS.has(reason)) {
    return true;
  }
  const text = errorText(error);
  return GATEWAY_NOT_READY_TEXT.some((pattern) => pattern.test(text));
}

/**
 * A Trunk that has not finished startup, or a gateway that is restarting or suspending, refuses work. That describes
 * the Trunk and the gateway, not the job, so it never counts as a failed attempt.
 */
export function isTrunkUnavailableError(error: unknown): boolean {
  return isRetryableInfrastructureError(error);
}

export type TrunkAvailabilityStatus = "available" | "unavailable" | "failed";

/** What a sweep remembers across passes: which Trunks are not ready, and until when they are left alone. */
export type TrunkAvailability = {
  unavailable: Map<string, { detail: string; retryAt: number }>;
  report?: (agentId: string, status: TrunkAvailabilityStatus, detail: string) => void;
};

/**
 * Logs a Trunk's availability only when it changes. A Trunk that stays not ready is named once, not on every pass.
 */
export function trunkAvailabilityLogger(
  log: (message: string) => void,
): NonNullable<TrunkAvailability["report"]> {
  const last = new Map<string, TrunkAvailabilityStatus>();
  return (agentId, status, detail) => {
    if (last.get(agentId) === status) {
      return;
    }
    last.set(agentId, status);
    if (status === "unavailable") {
      log(`trunk queue: ${agentId} is not ready (${detail}); its queued jobs wait until it is`);
    } else if (status === "available") {
      log(`trunk queue: ${agentId} is ready again`);
    } else {
      log(`trunk queue: ${agentId} could not take a job: ${detail}`);
    }
  };
}
