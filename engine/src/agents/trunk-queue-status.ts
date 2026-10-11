// Small shared helpers for the Trunk queue: the recognised refusal of a Trunk that is not ready, and how a sweep reports
// a Trunk's availability (logged only when it changes).
import { isRuntimeRaceFailure } from "../sessions/session-run-error-presentation.js";
import { isModelNotFoundErrorMessage } from "./live-model-errors.js";

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
    errorText(error).includes("has not completed startup inspection")
  );
}

// The Trunk's runtime was not published yet, its preparation timed out, or the state store was offline: the
// not-ready failures main-session-restart-dispatch.ts retries and gateway-state-owner.ts reports.
const NOT_READY_RUN_FAILURES =
  /runtime owner was not published|is undergoing offline maintenance|has not completed startup inspection|preparation watchdog/i;

/**
 * A claimed run that failed because its Trunk could not run anything yet: a startup race, a not-ready refusal, an offline
 * state store, or a model the Trunk cannot reach right now. The brief never ran, so like an UNAVAILABLE refusal at
 * dispatch it is not a failed attempt of the job.
 */
export function isTrunkNotReadyRunFailure(error: unknown, errorKind?: unknown): boolean {
  // Contention may happen after execution; its text must never grant a free replay.
  if (errorKind === "state_contention") {
    return false;
  }
  const text = errorText(error);
  return (
    isTrunkUnavailableError(error) ||
    isRuntimeRaceFailure(error) ||
    NOT_READY_RUN_FAILURES.test(text) ||
    isModelNotFoundErrorMessage(text)
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
