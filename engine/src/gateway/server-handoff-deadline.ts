// The step-down deadline of a seamless handoff (#481). An overrun aborts the handoff: the old engine waits for the
// late step to settle, restores its producers and keeps serving, and the desktop retries the update later. Only a step
// that never settles (or a restore that cannot finish) is fatal, because then this engine cannot safely serve again.

/** The deadline on an idle host. */
export const HANDOFF_DEACTIVATION_BASE_MS = 18_000;
/** Extra time per run the old engine is still carrying when the step-down starts. */
export const HANDOFF_DEACTIVATION_PER_RUN_MS = 3_000;
/** Extra time per queued command (the writer queue the step-down must fence behind). */
export const HANDOFF_DEACTIVATION_PER_QUEUED_MS = 500;
/**
 * The ceiling. The desktop waits 60 s for the step-down answer (desktop/src/handoff-timeouts.json stepDownTimeoutMs);
 * an aborted step-down must still let its late step settle and restore its producers inside that window, so
 * max + settle window + restore budget stays under it and an abort is always answered as refused, never unanswered.
 */
export const HANDOFF_DEACTIVATION_MAX_MS = 30_000;
/** How long an overrun step (or a late state-lease release) gets to settle before it is treated as stuck. */
export const HANDOFF_SETTLE_WINDOW_MS = 12_000;
/** The fresh budget the producer restore gets after an aborted step-down. */
export const HANDOFF_RESTORE_MS = 12_000;

export type HandoffDeactivationBudget = { ms: number; reason: string };

/**
 * Sizes the step-down deadline from the load it has to fence: active runs and queued commands. The environment
 * (BRANCH_GATEWAY_HANDOFF_DEADLINE_MS) can set it outright; either way it stays within [base, max].
 */
export function resolveHandoffDeactivationBudget(params: {
  activeRuns: number;
  queuedCommands: number;
  env?: NodeJS.ProcessEnv;
}): HandoffDeactivationBudget {
  const clamp = (ms: number) =>
    Math.min(HANDOFF_DEACTIVATION_MAX_MS, Math.max(HANDOFF_DEACTIVATION_BASE_MS, Math.round(ms)));
  const configured = Number(params.env?.BRANCH_GATEWAY_HANDOFF_DEADLINE_MS);
  if (Number.isFinite(configured) && configured > 0) {
    return {
      ms: clamp(configured),
      reason: `configured by BRANCH_GATEWAY_HANDOFF_DEADLINE_MS=${configured}`,
    };
  }
  const runs = Math.max(0, Math.floor(params.activeRuns));
  const queued = Math.max(0, Math.floor(params.queuedCommands));
  const ms = clamp(
    HANDOFF_DEACTIVATION_BASE_MS +
      runs * HANDOFF_DEACTIVATION_PER_RUN_MS +
      queued * HANDOFF_DEACTIVATION_PER_QUEUED_MS,
  );
  const capped = ms === HANDOFF_DEACTIVATION_MAX_MS ? ", capped" : "";
  return { ms, reason: `${runs} active run(s), ${queued} queued command(s)${capped}` };
}

export function formatHandoffSeconds(ms: number): string {
  return `${Math.round(ms / 1000)} seconds`;
}

/**
 * A step-down step overran the deadline. Not fatal: `settled` resolves once the late step finished (either way), and
 * only then may the engine restore its producers without racing it.
 */
export class GatewayHandoffDeadlineError extends Error {
  constructor(
    readonly budgetMs: number,
    readonly step: string,
    readonly settled: Promise<void>,
  ) {
    super(
      `Gateway handoff deactivation exceeded ${formatHandoffSeconds(budgetMs)} at ${step}; the handoff was aborted and this engine keeps serving`,
    );
    this.name = "GatewayHandoffDeadlineError";
  }
}

export function isGatewayHandoffDeadlineError(
  error: unknown,
): error is GatewayHandoffDeadlineError {
  return error instanceof GatewayHandoffDeadlineError;
}

/** Races `work` against `deadline`; an overrun rejects with a GatewayHandoffDeadlineError that tracks the late work. */
export async function raceHandoffDeadline<T>(
  work: Promise<T>,
  deadline: number,
  budgetMs: number,
  step: string,
): Promise<T> {
  // Steps may return a plain value (a synchronous stop); treat it as already settled.
  const settled = Promise.resolve(work).then(
    () => undefined,
    () => undefined,
  );
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new GatewayHandoffDeadlineError(budgetMs, step, settled);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new GatewayHandoffDeadlineError(budgetMs, step, settled)),
          remaining,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** True once `settled` resolves, false when `withinMs` runs out first. */
export async function settlesWithin(settled: Promise<void>, withinMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, withinMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
