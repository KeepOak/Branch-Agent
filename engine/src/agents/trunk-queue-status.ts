// Small shared helpers for the Trunk queue: the recognised refusal of a Trunk that is not ready, and how a sweep reports
// a Trunk's availability (logged only when it changes).
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A Trunk that has not finished startup refuses work with UNAVAILABLE. That describes the Trunk, not the job, so
 * it never counts as a failed attempt.
 */
export function isTrunkUnavailableError(error: unknown): boolean {
  const shape = rec(error);
  return (
    shape.gatewayCode === "UNAVAILABLE" ||
    shape.code === "UNAVAILABLE" ||
    /has not completed startup inspection/.test(errorText(error))
  );
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
