import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { AgentDatabaseAdmissionRefusal } from "./agent-database-admission.js";

const log = createSubsystemLogger("state/agent-admission");

/** A pre-prepare stage that did not finish within its time limit; its attempt fails and retries. */
export class StageTimeoutError extends Error {
  constructor(
    readonly stage: string,
    limitMs: number,
  ) {
    super(`${stage} did not finish within ${limitMs}ms`);
  }
}

/**
 * Bounds one startup stage. A stage whose work ignores its abort still ends at its limit, and a value
 * that arrives after the limit goes to `release`, so a permit granted late is not leaked.
 */
export function boundStage<T>(
  stage: string,
  work: Promise<T>,
  limitMs: number,
  signal: AbortSignal,
  release?: (value: T) => void,
): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new StageTimeoutError(stage, limitMs));
    }, limitMs);
    timer.unref?.();
  });
  work.then(
    (value) => {
      if (expired) {
        release?.(value);
      }
    },
    () => {},
  );
  return racePromiseWithAbortSignal(Promise.race([work, limit]), signal).finally(() => {
    clearTimeout(timer);
  });
}

/** Names the stage a pending preparation is in, and its last error, in the refusal cron and memory read. */
export function recordStage(
  refusal: AgentDatabaseAdmissionRefusal,
  base: string,
  stage: string,
  lastError?: string,
): void {
  refusal.reason = lastError
    ? `${base} Stage: ${stage}. Last error: ${lastError}`
    : `${base} Stage: ${stage}.`;
}

/**
 * Waits for a startup stage that a retry cannot repeat (the inspection, the Gateway's activation).
 * Each expiry is logged and recorded on the refusal; the wait goes on until the stage finishes or
 * startup stops.
 */
export async function waitForStage<T>(params: {
  agentId: string;
  stage: string;
  work: Promise<T>;
  limitMs: number;
  signal: AbortSignal;
  onExpired: () => void;
}): Promise<T> {
  for (;;) {
    try {
      return await boundStage(params.stage, params.work, params.limitMs, params.signal);
    } catch (error) {
      if (!(error instanceof StageTimeoutError) || params.signal.aborted) {
        throw error;
      }
      log.warn(`agent database startup ${params.stage} is still running; still waiting`, {
        agentId: params.agentId,
        limitMs: params.limitMs,
      });
      params.onExpired();
    }
  }
}
