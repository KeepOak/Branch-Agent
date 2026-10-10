import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  sameFileMutationFingerprint,
  type FileMutationFingerprint,
} from "../infra/file-descriptor.js";
import { readSqliteIntegrityFileIdentity } from "../infra/sqlite-file-generation.js";
import { withSqliteReadOnlyWorkerScope } from "../infra/sqlite-readonly-worker.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createDeferredCore } from "../shared/deferred.js";
import { createPermitPool } from "../shared/permit-pool.js";
import {
  AgentDatabasePreparationSupersededError,
  createAgentDatabaseInspectionRefusal,
  failPendingAgentDatabase,
  listAgentDatabaseAdmissionRefusals,
  preparePendingAgentDatabase,
  type AgentDatabaseAdmissionRefusal,
} from "./agent-database-admission.js";
import { readAgentDeletionJournalStatusInWorker } from "./agent-deletion-journal.read.js";
import {
  boundStage,
  recordStage,
  StageTimeoutError,
  waitForStage,
} from "./agent-database-startup.stages.js";
import {
  AGENT_DATABASE_PREFLIGHT_CONCURRENCY,
  BRANCH_AGENT_SCHEMA_VERSION,
} from "./branch-agent-db-contract.js";
import {
  createBranchAgentDatabasePathMatcher,
  isSameBranchAgentDatabasePath,
} from "./branch-agent-db.paths.js";
import type { BranchDatabaseSchemaPreflight } from "./branch-database-preflight.types.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

type PendingInspection = {
  target: { agentId?: string; path: string };
  result: Promise<BranchDatabaseSchemaPreflight>;
};
type PreparationInput = {
  agentId: string;
  paths: readonly string[];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  assertCurrent: () => void;
};
type Activation = {
  isCurrent: () => boolean;
  /**
   * Called before every retry: whatever the failed attempt left running for this agent (a model
   * build that never settles) stops holding its next attempt, and siblings' publications, back.
   * Siblings' own builds are untouched.
   */
  replaceAgent: (input: {
    agentId: string;
    env: NodeJS.ProcessEnv;
    reason: Error;
  }) => Promise<unknown>;
  openAgent: (input: PreparationInput) => Promise<void>;
  prepareAgent: (input: PreparationInput) => Promise<void>;
};
type SchemaSourceWitness = Array<FileMutationFingerprint | undefined>;
type PreparedSchemaHeaders = {
  statePath: string;
  headers: Map<
    string,
    { version: typeof BRANCH_AGENT_SCHEMA_VERSION; witness: SchemaSourceWitness }
  >;
};

function readSchemaSourceWitness(pathname: string): SchemaSourceWitness | undefined {
  try {
    const files = ["", "-wal", "-journal"].map((suffix) =>
      statSync(`${pathname}${suffix}`, { bigint: true, throwIfNoEntry: false }),
    );
    return files[0] && files.every((file) => !file || file.isFile()) ? files : undefined;
  } catch {
    return undefined;
  }
}

function matchesSchemaSourceWitness(
  before: SchemaSourceWitness,
  after: SchemaSourceWitness | undefined,
): boolean {
  return Boolean(
    after &&
    before.every((file, index) => {
      const current = after[index];
      return file ? current && sameFileMutationFingerprint(file, current) : !current;
    }),
  );
}

function matchesInspectionPath(
  paths: readonly string[],
  target: string,
  samePath = isSameBranchAgentDatabasePath,
): boolean {
  return paths.some((pathname) => {
    try {
      return samePath(pathname, target);
    } catch {
      // An uncertain sibling cannot classify this target; its own inspection reports the failure.
      return false;
    }
  });
}

const DEFAULT_PREPARATION_ATTEMPT_MS = 120_000;
const MAX_PREPARATION_ATTEMPT_MS = 600_000;

function preparationAttemptLimitMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.BRANCH_AGENT_PREPARATION_ATTEMPT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_PREPARATION_ATTEMPT_MS;
}

const DEFAULT_FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;
/**
 * Failed attempts in a row before startup starts the preparation again from scratch, with a fresh
 * backoff and time limit. The backoff has reached its one-minute ceiling by then (2, 4, 8, 16, 32,
 * 60 s).
 */
const FAILURES_BEFORE_RESTART = 6;
/**
 * Starts in a row (the first and each restart from scratch) whose attempts all failed before startup
 * stops retrying on its own. The agent then needs attention: only a retry request starts it again,
 * with a fresh count.
 */
const FAILED_STARTS_BEFORE_ATTENTION = 5;

/** Resolves when `signal` aborts. */
function untilAborted(signal: AbortSignal): Promise<void> {
  return signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
}

function firstRetryMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.BRANCH_AGENT_PREPARATION_RETRY_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FIRST_RETRY_MS;
}

const log = createSubsystemLogger("state/agent-admission");
const startupAdmission = new AsyncLocalStorage<AgentDatabaseStartupAdmission>();
/** Admissions the running Gateway adopted; a retry request reaches their pending agents. */
const adoptedAdmissions = new Set<AgentDatabaseStartupAdmission>();

/** Ends a running attempt because the agent's preparation was asked to start again now. */
class StartupRetryRequestedError extends Error {}

/** Startup owns readers until the Gateway adopts them; only the Gateway activates agents. */
class AgentDatabaseStartupAdmission {
  constructor(private readonly deferInspections = true) {}

  private readonly controller = new AbortController();
  private readonly activation = createDeferredCore<Activation | undefined>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly pending = new Map<string, AgentDatabaseAdmissionRefusal>();
  /** Starts a preparing agent again from scratch now, during its backoff or a running attempt. */
  private readonly retries = new Map<string, () => void>();
  private adopted = false;
  private activated = false;
  private stopped = false;
  private stopping?: Promise<void>;
  private preparation: Promise<void> = Promise.resolve();
  private readonly opening = createPermitPool(AGENT_DATABASE_PREFLIGHT_CONCURRENCY);
  private preparedSchemaHeaders?: PreparedSchemaHeaders;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** Starts a preparing agent's preparation again from scratch now; false when it isn't preparing. */
  retryNow(agentId: string): boolean {
    const retry = this.retries.get(agentId);
    retry?.();
    return retry !== undefined;
  }

  /** Full readiness stays fresh; only unchanged compatibility headers cross into bootstrap. */
  prepareSchemaHeaders(env: NodeJS.ProcessEnv) {
    const prepared: PreparedSchemaHeaders = {
      statePath: resolveBranchStateSqlitePath(env),
      headers: new Map(),
    };
    this.preparedSchemaHeaders = prepared;
    return (pathname: string) => {
      const before = readSchemaSourceWitness(pathname);
      return (version: number) => {
        if (
          !this.stopped &&
          this.preparedSchemaHeaders === prepared &&
          before &&
          version === BRANCH_AGENT_SCHEMA_VERSION &&
          matchesSchemaSourceWitness(before, readSchemaSourceWitness(pathname))
        ) {
          prepared.headers.set(pathname, { version, witness: before });
        }
      };
    };
  }

  takePreparedSchemaHeaders(env: NodeJS.ProcessEnv) {
    const prepared = this.preparedSchemaHeaders;
    this.preparedSchemaHeaders = undefined;
    return (pathname: string, supportedVersion: number) => {
      const header = prepared?.headers.get(pathname);
      return !this.stopped &&
        prepared?.statePath === resolveBranchStateSqlitePath(env) &&
        header?.version === supportedVersion &&
        matchesSchemaSourceWitness(header.witness, readSchemaSourceWitness(pathname))
        ? { version: header.version }
        : undefined;
    };
  }

  track(work: Promise<unknown>): void {
    this.work.add(work);
    void work.then(
      () => this.work.delete(work),
      () => this.work.delete(work),
    );
  }

  scheduling(
    env: NodeJS.ProcessEnv,
    runtimePaths: readonly string[],
    runtimeAgentIds: ReadonlySet<string>,
  ) {
    const samePath = createBranchAgentDatabasePathMatcher();
    return {
      signal: this.signal,
      canDefer: (target: PendingInspection["target"]) =>
        this.deferInspections &&
        target.agentId !== undefined &&
        runtimeAgentIds.has(target.agentId) &&
        matchesInspectionPath(runtimePaths, target.path, samePath),
      track: (work: Promise<unknown>) => this.track(work),
      defer: (inspections: PendingInspection[], reason: string) =>
        this.defer({ env, inspections, reason }),
    };
  }

  recordInspectionFailure(
    target: PendingInspection["target"],
    inspection: BranchDatabaseSchemaPreflight,
    error: unknown,
  ): boolean {
    this.signal.throwIfAborted();
    if (!target.agentId) {
      return false;
    }
    (inspection.agentRefusals ??= []).push(
      createAgentDatabaseInspectionRefusal({
        agentId: target.agentId,
        paths: [target.path],
        reason: formatErrorMessage(error),
        cause: error,
      }),
    );
    return true;
  }

  captureRefusals(env: NodeJS.ProcessEnv): ReadonlyMap<string, AgentDatabaseAdmissionRefusal> {
    return new Map(
      listAgentDatabaseAdmissionRefusals({ env })
        .filter((refusal) => this.pending.get(refusal.agentId) === refusal)
        .map((refusal) => [refusal.agentId, refusal]),
    );
  }

  reuseRefusal(
    target: PendingInspection["target"],
    inspection: BranchDatabaseSchemaPreflight,
    priorRefusals?: ReadonlyMap<string, AgentDatabaseAdmissionRefusal>,
  ): boolean {
    const refusal = target.agentId && priorRefusals?.get(target.agentId);
    if (!refusal || !matchesInspectionPath(refusal.paths, target.path)) {
      return false;
    }
    (inspection.agentRefusals ??= []).push(refusal);
    return true;
  }

  defer(params: {
    env: NodeJS.ProcessEnv;
    inspections: readonly PendingInspection[];
    reason: string;
  }): AgentDatabaseAdmissionRefusal[] {
    this.signal.throwIfAborted();
    const env = cloneEnvWithPlatformSemantics(params.env);
    const grouped = new Map<string, PendingInspection[]>();
    for (const inspection of params.inspections) {
      const agentId = inspection.target.agentId;
      if (!agentId) {
        throw new Error(
          `Cannot defer a database without an agent owner: ${inspection.target.path}`,
        );
      }
      grouped.set(agentId, [...(grouped.get(agentId) ?? []), inspection]);
    }
    const refusals: AgentDatabaseAdmissionRefusal[] = [];
    for (const [agentId, inspections] of grouped) {
      const paths = [...new Set(inspections.map(({ target }) => target.path))];
      const statusReason = `Agent ${agentId} has not completed startup inspection and preparation. ${params.reason}`;
      const refusal = createAgentDatabaseInspectionRefusal({
        agentId,
        paths,
        pending: true,
        reason: statusReason,
      });
      this.pending.set(agentId, refusal);
      refusals.push(refusal);
      log.warn(refusal.reason, { agentId, paths, repairHint: refusal.repairHint });
      const witnesses = paths.map((pathname) => {
        try {
          return { pathname, identity: readSqliteIntegrityFileIdentity(pathname) };
        } catch (error) {
          return { pathname, error };
        }
      });
      // Observe failures immediately, but publish their outcome only after startup
      // records the pending decisions and the Gateway accepts their lifetime.
      const checked = Promise.allSettled(inspections.map(({ result }) => result));
      const recovery = (async () => {
        const limitMs = preparationAttemptLimitMs(env);
        const results = await waitForStage({
          agentId,
          stage: "inspection",
          work: checked,
          limitMs,
          signal: this.signal,
          onExpired: () => recordStage(refusal, statusReason, "inspection"),
        });
        const activation = await waitForStage({
          agentId,
          stage: "gateway activation",
          work: this.activation.promise,
          limitMs,
          signal: this.signal,
          onExpired: () => recordStage(refusal, statusReason, "gateway activation"),
        });
        if (!activation || this.stopped) {
          return;
        }
        const prepare = async () => {
          const assertCurrent = () => {
            this.signal.throwIfAborted();
            if (!activation.isCurrent() || this.pending.get(agentId) !== refusal) {
              throw new Error(`Gateway no longer owns preparation for agent ${agentId}`);
            }
            for (const witness of witnesses) {
              if (!witness.identity) {
                throw witness.error;
              }
              readSqliteIntegrityFileIdentity(witness.pathname, witness.identity);
            }
          };
          const assertNotDeleted = async (signal: AbortSignal) => {
            assertCurrent();
            const deletion = await boundStage(
              "deletion-journal read",
              readAgentDeletionJournalStatusInWorker(agentId, { env }, signal),
              attemptLimitMs,
              signal,
            );
            assertCurrent();
            if (deletion !== "absent") {
              throw new Error(`Agent ${agentId} was deleted during startup inspection`);
            }
          };
          // Each attempt gets its own time limit, counted from when it holds the preparation lane
          // (never while it waits behind a sibling), doubled after each expiry so a slow machine
          // still finishes. An expired attempt releases the lane even if its work ignores the abort.
          let attemptLimitMs = preparationAttemptLimitMs(env);
          const attempt = (controller: AbortController) => {
            const signal = AbortSignal.any([this.signal, controller.signal]);
            const assertAttemptCurrent = () => {
              signal.throwIfAborted();
              assertCurrent();
            };
            return withSqliteReadOnlyWorkerScope(
              async () => {
                await assertNotDeleted(signal);
                await preparePendingAgentDatabase(
                  refusal,
                  { env, assertCurrent: assertAttemptCurrent },
                  async () => {
                    const input = {
                      agentId,
                      paths,
                      env,
                      signal,
                      assertCurrent: assertAttemptCurrent,
                    };
                    const release = await boundStage(
                      "opening permit",
                      this.opening.acquire({ signal }),
                      attemptLimitMs,
                      signal,
                      (granted) => granted?.(),
                    );
                    try {
                      assertAttemptCurrent();
                      await boundStage(
                        "open",
                        activation.openAgent(input),
                        attemptLimitMs,
                        signal,
                      );
                    } finally {
                      release?.();
                    }
                    // A failed agent must release the preparation lane before its backoff;
                    // otherwise one degraded agent blocks every sibling indefinitely.
                    const completion = createDeferredCore();
                    const previous = this.preparation;
                    this.preparation = completion.promise;
                    try {
                      // A holder's own stages are bounded, so a longer wait means the lane is stuck.
                      await boundStage("preparation lane", previous, MAX_PREPARATION_ATTEMPT_MS, signal);
                      const timer = setTimeout(() => {
                        log.warn("agent database preparation watchdog: attempt expired; retrying", {
                          agentId,
                          paths,
                          attemptLimitMs,
                        });
                        controller.abort(
                          new Error(`Agent ${agentId} preparation watchdog expired`),
                        );
                      }, attemptLimitMs);
                      timer.unref?.();
                      try {
                        await racePromiseWithAbortSignal(activation.prepareAgent(input), signal);
                        await assertNotDeleted(signal);
                      } finally {
                        clearTimeout(timer);
                      }
                    } finally {
                      completion.resolve();
                    }
                  },
                );
              },
              { signal, deadlineOwnedByCaller: true },
            ).catch((error: unknown) => {
              if (controller.signal.aborted && !this.signal.aborted) {
                attemptLimitMs = Math.min(attemptLimitMs * 2, MAX_PREPARATION_ATTEMPT_MS);
              }
              throw error;
            });
          };
          try {
            assertCurrent();
            for (const result of results) {
              if (result.status === "rejected") {
                throw result.reason;
              }
              const inspection = result.value;
              if (
                inspection.incompatible.length ||
                inspection.indeterminate.length ||
                inspection.agentRefusals?.length ||
                inspection.pendingMigrations?.length
              ) {
                throw new Error(
                  inspection.agentRefusals?.map((entry) => entry.reason).join("; ") ||
                    inspection.indeterminate.map((entry) => entry.reason).join("; ") ||
                    `Agent ${agentId} database requires Doctor before preparation`,
                );
              }
            }
            const initialRetryMs = firstRetryMs(env);
            let retryDelayMs = initialRetryMs;
            let failures = 0;
            let failedStarts = 0;
            /** The running attempt, ended by a retry request; set between attempts' starts and ends. */
            let running: AbortController | undefined;
            let wake: AbortController | undefined;
            let requested = false;
            const retry = () => {
              requested = true;
              running?.abort(new StartupRetryRequestedError(`Agent ${agentId} retry requested`));
              wake?.abort();
            };
            this.retries.set(agentId, retry);
            // Every retry first replaces what the failed attempt left running: a model build that
            // never settles would otherwise hold this agent's next build, and every sibling
            // publication that covers it, behind it indefinitely.
            const replace = async (reason: Error) => {
              try {
                await racePromiseWithAbortSignal(
                  activation.replaceAgent({ agentId, env, reason }),
                  this.signal,
                );
              } catch (error) {
                if (this.stopped) {
                  throw error;
                }
                log.warn("agent database startup preparation could not be replaced", {
                  agentId,
                  reason: formatErrorMessage(error),
                });
              }
            };
            const restartFromScratch = async (reason: Error, replaceFirst = true) => {
              if (requested) {
                // A retry request starts a fresh series of starts.
                failedStarts = 0;
              }
              failures = 0;
              retryDelayMs = initialRetryMs;
              attemptLimitMs = preparationAttemptLimitMs(env);
              requested = false;
              if (refusal.preparation) {
                // Only a failed preparation reports its status (and counts its restarts).
                refusal.preparation = {
                  ...refusal.preparation,
                  state: "retrying",
                  restarts: refusal.preparation.restarts + 1,
                };
              }
              if (replaceFirst) {
                await replace(reason);
              }
            };
            try {
              for (;;) {
                // A request made before this attempt starts is answered by starting it.
                requested = false;
                running = new AbortController();
                try {
                  await attempt(running);
                  break;
                } catch (error) {
                  running = undefined;
                  if (this.stopped) {
                    throw error;
                  }
                  assertCurrent();
                  if (requested) {
                    log.info("agent database startup preparation retried on request", { agentId });
                    await restartFromScratch(new Error(`Agent ${agentId} retry requested`));
                    continue;
                  }
                  if (error instanceof AgentDatabasePreparationSupersededError) {
                    log.info("agent database startup preparation superseded; retrying", {
                      agentId,
                    });
                    continue;
                  }
                  failures += 1;
                  refusal.preparation = {
                    state: "retrying",
                    failures: (refusal.preparation?.failures ?? 0) + 1,
                    restarts: refusal.preparation?.restarts ?? 0,
                  };
                  const restart = failures >= FAILURES_BEFORE_RESTART;
                  if (restart) {
                    failedStarts += 1;
                  }
                  const attention = restart && failedStarts >= FAILED_STARTS_BEFORE_ATTENTION;
                  const reason = formatErrorMessage(error);
                  recordStage(
                    refusal,
                    statusReason,
                    error instanceof StageTimeoutError ? error.stage : "preparation",
                    reason,
                  );
                  const replacement = new Error(`Agent ${agentId} preparation: ${reason}`);
                  log.warn(
                    attention
                      ? "agent database startup preparation keeps failing; stopped retrying, it needs attention"
                      : restart
                        ? "agent database startup preparation keeps failing; starting it again from scratch"
                        : "agent database startup preparation failed; retrying",
                    { agentId, paths, reason, retryDelayMs, failures, failedStarts },
                  );
                  wake = new AbortController();
                  try {
                    if (attention) {
                      refusal.preparation = { ...refusal.preparation, state: "needs-attention" };
                      // Nothing retries it on its own any more: release what the attempt left running.
                      await replace(replacement);
                      if (!requested) {
                        await untilAborted(AbortSignal.any([this.signal, wake.signal]));
                        this.signal.throwIfAborted();
                      }
                    } else if (!requested) {
                      await delay(retryDelayMs, undefined, {
                        signal: AbortSignal.any([this.signal, wake.signal]),
                      });
                    }
                  } catch (waitError) {
                    if (!wake.signal.aborted || this.signal.aborted) {
                      throw waitError;
                    }
                  } finally {
                    wake = undefined;
                  }
                  if (requested) {
                    log.info("agent database startup preparation retried on request", { agentId });
                  }
                  if (attention) {
                    // Its replacement already ran; only a retry request reaches this point.
                    await restartFromScratch(new Error(`Agent ${agentId} retry requested`), false);
                  } else if (restart || requested) {
                    await restartFromScratch(replacement);
                  } else {
                    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
                    await replace(replacement);
                  }
                }
              }
            } finally {
              if (this.retries.get(agentId) === retry) {
                this.retries.delete(agentId);
              }
            }
            log.info("agent database recovered after background inspection and preparation", {
              agentId,
              paths,
            });
          } catch (error) {
            if (!this.stopped) {
              const reason = formatErrorMessage(error);
              failPendingAgentDatabase(refusal, error, { env });
              log.warn("agent database remains degraded", { agentId, paths, reason });
            }
          } finally {
            if (this.pending.get(agentId) === refusal) {
              this.pending.delete(agentId);
            }
          }
        };
        await prepare();
      })();
      this.track(recovery);
    }
    return refusals;
  }

  adopt(): { stop: () => Promise<void> } {
    this.signal.throwIfAborted();
    if (this.adopted) {
      throw new Error("Agent database startup admission already belongs to a Gateway");
    }
    this.adopted = true;
    adoptedAdmissions.add(this);
    return { stop: () => this.stop() };
  }

  activate(activation: Activation): void {
    if (!this.adopted || this.stopped || this.activated) {
      return;
    }
    this.activated = true;
    this.activation.resolve(activation);
  }

  async releaseStartup(): Promise<void> {
    if (!this.adopted) {
      await this.stop();
    }
  }

  stop(): Promise<void> {
    return (this.stopping ??= (async () => {
      this.stopped = true;
      adoptedAdmissions.delete(this);
      this.preparedSchemaHeaders = undefined;
      this.controller.abort(new Error("Gateway stopped during agent database inspection"));
      this.activation.resolve(undefined);
      while (this.work.size > 0) {
        await Promise.allSettled(this.work);
      }
    })());
  }
}

/**
 * Starts a pending agent's startup preparation again from scratch now, in the running Gateway,
 * whether it is backing off or in a running (possibly hung) attempt. False when that agent is not
 * preparing: it is ready, its inspection has not finished, or it failed for a reason only Doctor
 * can repair.
 */
export function retryAgentDatabaseStartupPreparation(agentId: string): boolean {
  let retried = false;
  for (const admission of adoptedAdmissions) {
    retried = admission.retryNow(agentId) || retried;
  }
  return retried;
}

export function getAgentDatabaseStartupAdmission(): AgentDatabaseStartupAdmission | undefined {
  const scope = startupAdmission.getStore();
  return scope?.isStopped ? undefined : scope;
}

export async function withAgentDatabaseStartupAdmission<T>(
  run: (admission: AgentDatabaseStartupAdmission) => Promise<T>,
  options: { deferInspections?: boolean } = {},
): Promise<T> {
  const admission =
    getAgentDatabaseStartupAdmission() ??
    new AgentDatabaseStartupAdmission(options.deferInspections);
  try {
    return await startupAdmission.run(admission, () => run(admission));
  } finally {
    await admission.releaseStartup();
  }
}
