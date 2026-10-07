import { waitForActiveCronJobs } from "../cron/active-jobs.js";
import {
  abortActiveCronTaskRuns,
  waitForActiveCronTaskRuns,
} from "../cron/service/active-run-cancellation.js";
import type { getChildLogger } from "../logging.js";
import { SESSION_HANDOFF_LEASE_MAX_WAIT_MS } from "../process/session-handoff-lease-files.js";

const CRON_ACTIVE_RUN_SHUTDOWN_DRAIN_MS = 10_000;
const CRON_ACTIVE_RUN_HANDOFF_DRAIN_MS = 15_000;

export async function drainGatewayCron(params: {
  settlements: readonly Promise<unknown>[];
  logger: Pick<ReturnType<typeof getChildLogger>, "warn">;
  /** Handoff retains active runs until they finish before another scheduler takes state. */
  preserveActiveRuns?: boolean;
}): Promise<void> {
  const abortedRuns = params.preserveActiveRuns
    ? 0
    : abortActiveCronTaskRuns("Gateway shutting down.");
  const drainMs = params.preserveActiveRuns
    ? Math.min(CRON_ACTIVE_RUN_HANDOFF_DRAIN_MS, SESSION_HANDOFF_LEASE_MAX_WAIT_MS)
    : CRON_ACTIVE_RUN_SHUTDOWN_DRAIN_MS;
  // Payload cleanup precedes durable finalization; both retain the old state owner.
  let handoffTimer: ReturnType<typeof setTimeout> | undefined;
  const drains = Promise.all([
    waitForActiveCronTaskRuns(drainMs),
    waitForActiveCronJobs(drainMs),
    Promise.allSettled(params.settlements),
  ]);
  let result: Awaited<typeof drains>;
  try {
    result = params.preserveActiveRuns
      ? await Promise.race([
          drains,
          new Promise<never>((_, reject) => {
            handoffTimer = setTimeout(
              () => reject(new Error("Cron runs did not finish before Gateway handoff")),
              drainMs,
            );
          }),
        ])
      : await drains;
  } finally {
    clearTimeout(handoffTimer);
  }
  const [activeRunDrain, activeJobDrain, settlements] = result;
  if (!activeRunDrain.drained || !activeJobDrain.drained) {
    params.logger.warn(
      { abortedRuns, activeRuns: activeRunDrain.active, activeJobs: activeJobDrain.active },
      "cron: active runs did not drain before shutdown timeout",
    );
    if (params.preserveActiveRuns) {
      throw new Error("Cron runs did not finish before Gateway handoff");
    }
  }
  for (const settlement of settlements) {
    if (settlement.status === "rejected") {
      throw settlement.reason;
    }
  }
}
