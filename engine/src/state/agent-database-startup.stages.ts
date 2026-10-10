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
 * An open that expired too often while it held its permit. Its permit is released so the other agents
 * keep opening, and this agent fails: a hung open cannot be cancelled, so only doctor or a restart clears it.
 */
export class AgentOpenHungError extends Error {
  constructor(agentId: string, expiries: number) {
    super(`Agent ${agentId} open hung after ${expiries} expiries; run doctor or restart.`);
  }
}

/** One open of an agent: when it settles, the permit it holds, and how often it has expired. */
export type OpeningRecord = { settled: Promise<void>; release?: () => void; expiries: number };

/** Expiries of one open before it is treated as hung: its permit is released and its agent fails. */
const HUNG_OPEN_EXPIRIES_BEFORE_QUARANTINE = 3;

/** What an expired open does: retry while it has not expired too often; otherwise release its permit and fail its agent. */
export function openingExpiry(
  agentId: string,
  record: OpeningRecord,
  abortAttempt: (reason: unknown) => void,
): (error: StageTimeoutError) => void {
  return (error) => {
    record.expiries += 1;
    if (record.expiries < HUNG_OPEN_EXPIRIES_BEFORE_QUARANTINE) {
      log.warn("agent database open expired while it holds its permit; retrying", {
        agentId,
        expiries: record.expiries,
        permitHeld: record.release !== undefined,
      });
      abortAttempt(error);
      return;
    }
    log.warn("agent database open hung; releasing its permit and failing the agent", {
      agentId,
      expiries: record.expiries,
    });
    record.release?.();
    abortAttempt(new AgentOpenHungError(agentId, record.expiries));
  };
}

export type StageOptions<T> = {
  signal: AbortSignal;
  /** Runs when the stage expires, before its rejection reaches the caller: an attempt aborts itself here. */
  onExpire?: (error: StageTimeoutError) => void;
  /** Receives a value that arrives after the limit, so a permit granted late is handed straight back. */
  release?: (value: T) => void;
};

/**
 * Bounds one startup stage. A stage whose work ignores its abort still ends at its limit; the caller
 * decides what its expiry does (an attempt aborts itself, so its open sees the abort too).
 */
export function boundStage<T>(
  stage: string,
  work: Promise<T>,
  limitMs: number,
  options: StageOptions<T>,
): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      const error = new StageTimeoutError(stage, limitMs);
      reject(error);
      options.onExpire?.(error);
    }, limitMs);
    timer.unref?.();
  });
  work.then(
    (value) => {
      if (expired) {
        options.release?.(value);
      }
    },
    () => {},
  );
  return racePromiseWithAbortSignal(Promise.race([work, limit]), options.signal).finally(() => {
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
      return await boundStage(params.stage, params.work, params.limitMs, {
        signal: params.signal,
      });
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
