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
 * Failed attempts in a row before startup stops retrying the same preparation and starts it again
 * from scratch. The backoff has reached its one-minute ceiling by then (2, 4, 8, 16, 32, 60 s).
 */
const FAILURES_BEFORE_RESTART = 6;
/**
 * From-scratch restarts startup makes on its own. When the restarted preparation fails as often
 * again (about four minutes in all), the agent stops retrying and waits for a retry request: its
 * status says it needs a restart instead of retrying the same failure every minute for hours.
 */
const AUTOMATIC_RESTARTS = 1;

function firstRetryMs(env: NodeJS.ProcessEnv): number {
  const configured = Number(env.BRANCH_AGENT_PREPARATION_RETRY_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_FIRST_RETRY_MS;
}

const log = createSubsystemLogger("state/agent-admission");
const startupAdmission = new AsyncLocalStorage<AgentDatabaseStartupAdmission>();
/** Admissions the running Gateway adopted; a retry request reaches their pending agents. */
const adoptedAdmissions = new Set<AgentDatabaseStartupAdmission>();

/** Resolves when the signal aborts; a preparation that needs a restart waits here for a retry request. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Startup owns readers until the Gateway adopts them; only the Gateway activates agents. */
class AgentDatabaseStartupAdmission {
  constructor(private readonly deferInspections = true) {}

  private readonly controller = new AbortController();
  private readonly activation = createDeferredCore<Activation | undefined>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly pending = new Map<string, AgentDatabaseAdmissionRefusal>();
  /** Ends the backoff wait of an agent whose preparation is retrying, so it starts again now. */
  private readonly wakers = new Map<string, () => void>();
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

  /** Starts a retrying agent's preparation again from scratch now; false when it isn't retrying. */
  retryNow(agentId: string): boolean {
    const wake = this.wakers.get(agentId);
    wake?.();
    return wake !== undefined;
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
      const refusal = createAgentDatabaseInspectionRefusal({
        agentId,
        paths,
        pending: true,
        reason: `Agent ${agentId} has not completed startup inspection and preparation. ${params.reason}`,
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
        const results = await checked;
        const activation = await this.activation.promise;
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
            const deletion = await readAgentDeletionJournalStatusInWorker(agentId, { env }, signal);
            assertCurrent();
            if (deletion !== "absent") {
              throw new Error(`Agent ${agentId} was deleted during startup inspection`);
            }
          };
          // Each attempt gets its own time limit, counted from when it holds the preparation lane
          // (never while it waits behind a sibling), doubled after each expiry so a slow machine
          // still finishes. An expired attempt releases the lane even if its work ignores the abort.
          let attemptLimitMs = preparationAttemptLimitMs(env);
          const attempt = () => {
            const controller = new AbortController();
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
                    const release = await this.opening.acquire({ signal });
                    try {
                      assertAttemptCurrent();
                      await activation.openAgent(input);
                    } finally {
                      release?.();
                    }
                    // A failed agent must release the preparation lane before its backoff;
                    // otherwise one degraded agent blocks every sibling indefinitely.
                    const completion = createDeferredCore();
                    const previous = this.preparation;
                    this.preparation = completion.promise;
                    try {
                      await previous;
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
            const restartFromScratch = () => {
              failures = 0;
              retryDelayMs = initialRetryMs;
              attemptLimitMs = preparationAttemptLimitMs(env);
            };
            for (;;) {
              try {
                await attempt();
                break;
              } catch (error) {
                if (this.stopped) {
                  throw error;
                }
                assertCurrent();
                if (error instanceof AgentDatabasePreparationSupersededError) {
                  log.info("agent database startup preparation superseded; retrying", {
                    agentId,
                  });
                  continue;
                }
                failures += 1;
                const counts = {
                  failures: (refusal.preparation?.failures ?? 0) + 1,
                  restarts: refusal.preparation?.restarts ?? 0,
                };
                const restart = failures >= FAILURES_BEFORE_RESTART;
                const needsRestart = restart && counts.restarts >= AUTOMATIC_RESTARTS;
                refusal.preparation = {
                  state: needsRestart ? "needs-restart" : "retrying",
                  ...counts,
                };
                const reason = formatErrorMessage(error);
                log.warn(
                  needsRestart
                    ? "agent database startup preparation keeps failing; it waits for a retry request"
                    : restart
                      ? "agent database startup preparation keeps failing; starting it again from scratch"
                      : "agent database startup preparation failed; retrying",
                  { agentId, paths, reason, retryDelayMs, failures },
                );
                const wake = new AbortController();
                this.wakers.set(agentId, () => wake.abort());
                try {
                  const waitSignal = AbortSignal.any([this.signal, wake.signal]);
                  await (needsRestart
                    ? untilAborted(waitSignal)
                    : delay(retryDelayMs, undefined, { signal: waitSignal }));
                } catch (waitError) {
                  if (!wake.signal.aborted || this.signal.aborted) {
                    throw waitError;
                  }
                  log.info("agent database startup preparation retried on request", { agentId });
                } finally {
                  this.wakers.delete(agentId);
                }
                if (restart || wake.signal.aborted) {
                  restartFromScratch();
                  refusal.preparation = {
                    state: "retrying",
                    failures: counts.failures,
                    restarts: counts.restarts + 1,
                  };
                } else {
                  retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
                }
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
 * Starts a pending agent's failed startup preparation again from scratch now, in the running
 * Gateway. False when that agent is not waiting to retry (ready, still on its first attempt, or
 * failed for a reason only Doctor can repair).
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
