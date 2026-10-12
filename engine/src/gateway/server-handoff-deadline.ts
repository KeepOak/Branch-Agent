import { GatewayHandoffFatalError } from "./server-handoff-error.js";

/** Step-down budget for a quiet engine. */
export const HANDOFF_DEACTIVATION_BASE_MS = 18_000;
/** Extra step-down budget for each active run the engine must lease and park. */
export const HANDOFF_DEACTIVATION_PER_ACTIVE_RUN_MS = 2_000;
/** Extra step-down budget for each queued session-store write ahead of the drain. */
export const HANDOFF_DEACTIVATION_PER_QUEUED_WRITE_MS = 250;
/**
 * Ceiling for a scaled or configured budget. Budget, overrun settle window and restore budget together stay
 * inside the desktop step-down answer timeout (desktop/src/handoff-timeouts.json), so a slow step-down is
 * answered as refused and the desktop keeps the old engine instead of treating it as unanswered.
 */
export const HANDOFF_DEACTIVATION_MAX_MS = 30_000;
/** How long an overrunning step may still take to settle before nothing can be safely restored under it. */
export const HANDOFF_OVERRUN_SETTLE_MS = 12_000;
/** How long the old engine gets to restart its producers after an aborted step-down. */
export const HANDOFF_RESTORE_BUDGET_MS = 12_000;
/** Slack between the step-down's own guards and the outer guard around the whole step-down. */
export const HANDOFF_OUTER_GUARD_MARGIN_MS = 2_000;
/** Operator override for the step-down budget in milliseconds, capped at HANDOFF_DEACTIVATION_MAX_MS. */
export const HANDOFF_DEACTIVATION_BUDGET_ENV = "BRANCH_GATEWAY_HANDOFF_DEACTIVATION_MS";

export type GatewayHandoffDeadline = {
  /** Epoch ms by which every step-down step must have finished. */
  deadline: number;
  /** Budget the deadline was sized from. */
  budgetMs: number;
  /** Why the budget has this size, for the log line. */
  reason: string;
};

/** A step-down step overran its budget but settled: the handoff aborts and this engine keeps serving. */
export class GatewayHandoffDeadlineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GatewayHandoffDeadlineError";
  }
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} seconds`;

/** Sizes the step-down budget from engine load, or from the operator override. */
export function resolveGatewayHandoffDeadline(
  load: { activeRuns: number; queuedWrites: number },
  options: { now?: number; env?: NodeJS.ProcessEnv } = {},
): GatewayHandoffDeadline {
  const now = options.now ?? Date.now();
  const raw = (options.env ?? process.env)[HANDOFF_DEACTIVATION_BUDGET_ENV]?.trim();
  const configured = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(configured) && configured > 0) {
    const budgetMs = Math.min(Math.round(configured), HANDOFF_DEACTIVATION_MAX_MS);
    const capped = budgetMs < configured ? `, capped at ${HANDOFF_DEACTIVATION_MAX_MS} ms` : "";
    return {
      deadline: now + budgetMs,
      budgetMs,
      reason: `${HANDOFF_DEACTIVATION_BUDGET_ENV}=${raw}${capped}`,
    };
  }
  const activeRuns = Math.max(0, Math.floor(load.activeRuns));
  const queuedWrites = Math.max(0, Math.floor(load.queuedWrites));
  const scaled =
    HANDOFF_DEACTIVATION_BASE_MS +
    activeRuns * HANDOFF_DEACTIVATION_PER_ACTIVE_RUN_MS +
    queuedWrites * HANDOFF_DEACTIVATION_PER_QUEUED_WRITE_MS;
  const budgetMs = Math.min(scaled, HANDOFF_DEACTIVATION_MAX_MS);
  const capped = budgetMs < scaled ? `, capped at ${HANDOFF_DEACTIVATION_MAX_MS} ms` : "";
  return {
    deadline: now + budgetMs,
    budgetMs,
    reason: `${activeRuns} active run(s), ${queuedWrites} queued session write(s)${capped}`,
  };
}

/**
 * The outer limit for a whole step-down: its budget, then the overrun settle window, then restoring this engine.
 * The step-down's own guards always answer first; this only catches a step-down stuck outside them.
 */
export function resolveGatewayHandoffHardLimit(deadline: GatewayHandoffDeadline): number {
  return (
    deadline.deadline +
    HANDOFF_OVERRUN_SETTLE_MS +
    HANDOFF_RESTORE_BUDGET_MS +
    HANDOFF_OUTER_GUARD_MARGIN_MS
  );
}

/** The log line for an overrun: how long the budget was and why. */
export function describeGatewayHandoffOverrun(deadline: GatewayHandoffDeadline): string {
  return `Gateway handoff deactivation exceeded ${seconds(deadline.budgetMs)} (budget ${deadline.budgetMs} ms: ${deadline.reason})`;
}

type Settled<T> =
  | { settled: true; ok: true; value: T }
  | { settled: true; ok: false; reason: unknown };

async function settleWithin<T>(
  work: Promise<T>,
  ms: number,
): Promise<Settled<T> | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // Steps may return a plain value; treat it as an already-settled step.
      Promise.resolve(work).then(
        (value): Settled<T> => ({ settled: true, ok: true, value }),
        (reason: unknown): Settled<T> => ({ settled: true, ok: false, reason }),
      ),
      new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one step-down step against the handoff deadline. A step that overruns gets the settle window: once it
 * settles, the handoff aborts with a non-fatal GatewayHandoffDeadlineError so the caller restores this engine and
 * the update retries later. Only a step that never settles is fatal, because nothing can be restored under it.
 * With lateSuccess "accept", a step that succeeds inside the settle window counts as done: an ownership transfer
 * that completed late must not be reversed.
 */
export async function runBeforeHandoffDeadline<T>(
  work: Promise<T>,
  deadline: GatewayHandoffDeadline,
  options: { lateSuccess?: "abort" | "accept" } = {},
): Promise<T> {
  const onTime = await settleWithin(work, deadline.deadline - Date.now());
  if (onTime.settled) {
    if (onTime.ok) {
      return onTime.value;
    }
    throw onTime.reason;
  }
  const message = describeGatewayHandoffOverrun(deadline);
  const late = await settleWithin(work, HANDOFF_OVERRUN_SETTLE_MS);
  if (!late.settled) {
    throw new GatewayHandoffFatalError(
      `${message}; the overrunning step did not settle within ${seconds(HANDOFF_OVERRUN_SETTLE_MS)}`,
    );
  }
  if (late.ok && options.lateSuccess === "accept") {
    return late.value;
  }
  throw new GatewayHandoffDeadlineError(
    `${message}; the handoff was aborted and this engine keeps serving`,
    late.ok ? undefined : { cause: late.reason },
  );
}

/**
 * A hard limit with no settle window, for restoring this engine after an aborted step-down and for the outer guard
 * around a whole step-down: an overrun here is fatal, since this engine may not be serving.
 */
export async function runBeforeHardHandoffDeadline<T>(
  work: Promise<T>,
  deadline: number,
  message: string,
): Promise<T> {
  const outcome = await settleWithin(work, deadline - Date.now());
  if (!outcome.settled) {
    throw new GatewayHandoffFatalError(message);
  }
  if (outcome.ok) {
    return outcome.value;
  }
  throw outcome.reason;
}
