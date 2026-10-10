import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "./agent-database-admission.js";
import * as startup from "./agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "./branch-database-preflight.types.js";

// Module state the tests share through mocks. Every test resets it in beforeEach.
const stalls = vi.hoisted(() => ({
  /** The next this-many journal reads never settle; the rest answer at once. */
  journalReadsToStall: 0,
  journalStalled: 0,
}));
// Permits held by the pools created in this file, to check that no permit leaks.
const permits = vi.hoisted(() => ({ outstanding: 0, peak: 0 }));

// The journal read runs in a real worker, whose speed depends on the machine. Stub it: it answers
// at once unless a test stalls it on purpose.
vi.mock("./agent-deletion-journal.read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-deletion-journal.read.js")>();
  return {
    ...actual,
    readAgentDeletionJournalStatusInWorker: async () => {
      if (stalls.journalReadsToStall > 0) {
        stalls.journalReadsToStall -= 1;
        stalls.journalStalled += 1;
        await new Promise<never>(() => {});
      }
      return "absent" as const;
    },
  };
});

// The retry backoff sleeps on node:timers/promises. Route it through the global setTimeout, so the
// fake clock controls it too.
vi.mock("node:timers/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers/promises")>();
  return {
    ...actual,
    setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          resolve(value);
        }, ms);
        options?.signal?.addEventListener(
          "abort",
          () => {
            globalThis.clearTimeout(timer);
            reject(options.signal?.reason);
          },
          { once: true },
        );
      }),
  };
});

vi.mock("../shared/permit-pool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/permit-pool.js")>();
  return {
    ...actual,
    createPermitPool: (limit: number) => {
      const pool = actual.createPermitPool(limit);
      return {
        ...pool,
        acquire: async (options?: Parameters<typeof pool.acquire>[0]) => {
          const release = await pool.acquire(options);
          if (!release) {
            return release;
          }
          permits.outstanding += 1;
          permits.peak = Math.max(permits.peak, permits.outstanding);
          let released = false;
          return () => {
            if (!released) {
              released = true;
              permits.outstanding -= 1;
            }
            release();
          };
        },
      };
    },
  };
});

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function closeDatabases() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

beforeEach(() => {
  stalls.journalReadsToStall = 0;
  stalls.journalStalled = 0;
  permits.outstanding = 0;
  permits.peak = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await closeDatabases();
});

const CLEAN: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
const NEVER = (): Promise<BranchDatabaseSchemaPreflight> => new Promise(() => {});
/** A fake-clock sleep: it finishes when the test advances the clock past `ms`. */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Lets every microtask and ready macrotask run, without touching the fake clock. */
const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/**
 * Advances the fake clock one timer at a time until `done` holds. Deterministic: nothing here reads
 * the wall clock, so a slow machine only takes longer. Fails if no timer is left to advance first.
 */
async function runUntil(done: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 100_000; turn += 1) {
    await flush();
    if (done()) {
      return;
    }
    if (vi.getTimerCount() === 0) {
      throw new Error(`no timer left while waiting for ${what}`);
    }
    await vi.advanceTimersToNextTimerAsync();
  }
  throw new Error(`gave up waiting for ${what}`);
}

type Agent = {
  agentId: string;
  /** A function is called once the fake clock is installed, so its timers are fake too. */
  inspection?:
    | Promise<BranchDatabaseSchemaPreflight>
    | (() => Promise<BranchDatabaseSchemaPreflight>);
  prepareAgent?: (input: { signal: AbortSignal }) => Promise<void>;
};

/**
 * Starts startup preparation for the given agents in one admission, on fake timers. `open` is the
 * Gateway's open of one agent; the default opens at once. `armStall` runs after the databases are
 * open, so a stall cannot be spent on work done before the admission starts.
 */
async function startAdmission(
  agents: Agent[],
  extraEnv: Record<string, string>,
  open: (input: { agentId: string }) => Promise<void> = async () => {},
  armStall: () => void = () => {},
) {
  const env = {
    BRANCH_STATE_DIR: tempDirs.make("branch-startup-stages-"),
    BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "40",
    BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
    ...extraEnv,
  };
  const paths = new Map(
    agents.map(({ agentId }) => [agentId, openBranchAgentDatabase({ agentId, env }).path]),
  );
  await closeDatabases();
  armStall();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const openAgent = vi.fn(open);
  const replaceAgent = vi.fn(async () => {});
  const prepares = new Map(
    agents.map(({ agentId, prepareAgent }) => [agentId, vi.fn(prepareAgent ?? (async () => {}))]),
  );
  let stop: (() => Promise<void>) | undefined;
  await startup.withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: agents.map(({ agentId, inspection }) => ({
        target: { agentId, path: paths.get(agentId)! },
        result:
          typeof inspection === "function" ? inspection() : (inspection ?? Promise.resolve(CLEAN)),
      })),
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    admission.activate({
      isCurrent: () => true,
      openAgent,
      prepareAgent: async ({ agentId, signal }) => {
        await prepares.get(agentId)!({ signal });
      },
      replaceAgent,
    });
  });
  const refusal = (agentId: string) => readAgentDatabaseAdmissionRefusal(agentId, { env });
  const admitted = (agentId: string) =>
    runUntil(() => refusal(agentId) === undefined, `${agentId} to be admitted`);
  return {
    agentId: agents[0]!.agentId,
    env,
    prepares,
    openAgent,
    replaceAgent,
    refusal,
    admitted,
    stop: stop!,
  };
}

describe("agent database startup stages that could hang", () => {
  it("names a stage that is still waiting for its inspection, and keeps waiting while it has not finished", async () => {
    const started = await startAdmission([{ agentId: "tk", inspection: NEVER }], {});
    try {
      await runUntil(
        () => started.refusal("tk")?.reason.includes("Stage: inspection.") === true,
        "the inspection stage to be named",
      );
      expect(started.openAgent).not.toHaveBeenCalled();
      expect(started.prepares.get("tk")).not.toHaveBeenCalled();
      expect(started.refusal("tk")).toMatchObject({
        code: "agent-database-inspection-pending",
      });
    } finally {
      await started.stop();
    }
  });

  it("ends a stalled deletion-journal read at its limit, names the stage, and retries it", async () => {
    const started = await startAdmission(
      [{ agentId: "tk" }],
      { BRANCH_AGENT_PREPARATION_RETRY_MS: "400" },
      undefined,
      () => {
        stalls.journalReadsToStall = 1;
      },
    );
    try {
      await runUntil(
        () => started.refusal("tk")?.reason.includes("deletion-journal read") === true,
        "the journal read stage to be named",
      );
      await started.admitted("tk");
      expect(started.prepares.get("tk")).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop();
    }
  });

  it("does not let a hung holder keep the preparation lane shut: the sibling is admitted at the holder's limit", async () => {
    let holderCalls = 0;
    const started = await startAdmission(
      [
        {
          agentId: "tk",
          prepareAgent: async () => {
            holderCalls += 1;
            if (holderCalls === 1) {
              // Never settles and ignores its abort: the attempt's watchdog must end it.
              await new Promise(() => {});
            }
          },
        },
        { agentId: "builder-ash" },
      ],
      {},
    );
    try {
      await started.admitted("builder-ash");
      await started.admitted("tk");
      expect(holderCalls).toBeGreaterThanOrEqual(2);
    } finally {
      await started.stop();
    }
  });

  it("quarantines a hung open after its expiries: its permit is released, and its agent fails with open hung", async () => {
    const started = await startAdmission([{ agentId: "tk" }], {}, async () => {
      // Never settles: a hung open cannot be cancelled, so only its expiries can end its agent.
      await new Promise(() => {});
    });
    try {
      await runUntil(
        () =>
          started
            .refusal("tk")
            ?.reason.includes("open hung after 3 expiries; run doctor or restart.") === true,
        "the agent to fail with open hung",
      );
      expect(started.refusal("tk")).toMatchObject({
        code: "agent-database-inspection-failed",
      });
      expect(started.openAgent).toHaveBeenCalledTimes(1);
      expect(started.prepares.get("tk")).not.toHaveBeenCalled();
      // The hung open's permit went back to the pool on quarantine, although the open never settled.
      expect(permits.outstanding).toBe(0);
    } finally {
      await started.stop();
    }
  });

  it("two hung opens do not block a third agent's open: their permits are released on quarantine", async () => {
    const hung = new Set(["tk", "builder-ash"]);
    const started = await startAdmission(
      [
        { agentId: "tk" },
        { agentId: "builder-ash" },
        {
          agentId: "builder-elm",
          // Its inspection finishes after both hung opens have taken the two permits, so its
          // permit request queues behind them until they are quarantined.
          inspection: () => sleep(100).then(() => CLEAN),
        },
      ],
      {},
      async ({ agentId }) => {
        if (hung.has(agentId)) {
          await new Promise(() => {});
        }
      },
    );
    try {
      await started.admitted("builder-elm");
      expect(
        started.openAgent.mock.calls.filter(([input]) => input.agentId === "builder-elm"),
      ).toHaveLength(1);
      expect(started.prepares.get("builder-elm")).toHaveBeenCalledTimes(1);
      for (const agentId of hung) {
        expect(started.refusal(agentId)).toMatchObject({
          code: "agent-database-inspection-failed",
          reason: expect.stringContaining("open hung"),
        });
      }
      expect(permits.outstanding).toBe(0);
    } finally {
      await started.stop();
    }
  });

  it("a stalled open that completes after its expiry does not overlap the retry, publish twice, or leak its permit", async () => {
    const inFlight = { now: 0, peak: 0, perAgent: new Map<string, number>(), perAgentPeak: 0 };
    let tkCalls = 0;
    const started = await startAdmission(
      [{ agentId: "tk" }, { agentId: "builder-ash" }, { agentId: "builder-oak" }],
      {},
      async ({ agentId }) => {
        inFlight.now += 1;
        inFlight.peak = Math.max(inFlight.peak, inFlight.now);
        const own = (inFlight.perAgent.get(agentId) ?? 0) + 1;
        inFlight.perAgent.set(agentId, own);
        inFlight.perAgentPeak = Math.max(inFlight.perAgentPeak, own);
        try {
          if (agentId === "tk") {
            tkCalls += 1;
            if (tkCalls === 1) {
              // Ignores its abort and finishes after its stage expired.
              await sleep(150);
            }
          }
        } finally {
          inFlight.now -= 1;
          inFlight.perAgent.set(agentId, (inFlight.perAgent.get(agentId) ?? 1) - 1);
        }
      },
    );
    try {
      await started.admitted("tk");
      await started.admitted("builder-ash");
      await started.admitted("builder-oak");
      // The late open completes on its own; its permit is released only then.
      await runUntil(() => permits.outstanding === 0, "the late open's permit to be released");
      expect(inFlight.peak).toBeLessThanOrEqual(2);
      expect(inFlight.perAgentPeak).toBe(1);
      expect(permits.peak).toBeLessThanOrEqual(2);
      // Only the successful attempt publishes; the late open's attempt was aborted before it could.
      expect(started.prepares.get("tk")).toHaveBeenCalledTimes(1);
      expect(started.prepares.get("builder-ash")).toHaveBeenCalledTimes(1);
      expect(started.prepares.get("builder-oak")).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop();
    }
  });

  it("a permit queue wait longer than the stage limit does not expire while the holders run", async () => {
    const agentIds = ["a1", "a2", "a3", "a4", "a5", "a6"];
    // Each open takes 200ms, under the 300ms limit. The last two queue behind two pairs, for about
    // 400ms in all, which is over the limit. Queue time must not count against it.
    const started = await startAdmission(
      agentIds.map((agentId) => ({ agentId })),
      { BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "300" },
      async () => {
        await sleep(200);
      },
    );
    try {
      for (const agentId of agentIds) {
        await started.admitted(agentId);
      }
      for (const agentId of agentIds) {
        expect(
          started.openAgent.mock.calls.filter(([input]) => input.agentId === agentId),
        ).toHaveLength(1);
      }
      // No attempt failed, so no expiry fired: a queue wait that counted as stage time would have
      // failed an attempt and replaced its preparation.
      expect(started.replaceAgent).not.toHaveBeenCalled();
    } finally {
      await started.stop();
    }
  });

  it("a stage expiry grows the next attempt's limit, so each attempt is given more time than the last", async () => {
    stalls.journalReadsToStall = 0;
    // Base limit 40ms. Each stalled read expires at its limit, and each expiry doubles the next one:
    // 40, 80, 160, 320, 640, 1280ms. Without growth these six would take 240ms, not 2520ms.
    const started = await startAdmission([{ agentId: "tk" }], {}, undefined, () => {
      stalls.journalReadsToStall = 6;
    });
    const begun = Date.now();
    try {
      await started.admitted("tk");
      expect(Date.now() - begun).toBeGreaterThanOrEqual(2520);
      expect(stalls.journalStalled).toBe(6);
      expect(started.openAgent).toHaveBeenCalledTimes(1);
      expect(started.prepares.get("tk")).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop();
    }
  });
});
