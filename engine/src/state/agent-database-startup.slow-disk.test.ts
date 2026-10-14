import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

// #967: a fake slow disk. Each agent's deletion-journal reads answer after the fake milliseconds
// listed for it, in call order (the check before opening, then the check after preparation);
// reads past the list take `slowDisk.defaultMs`.
const slowDisk = vi.hoisted(() => ({
  delays: new Map<string, number[]>(),
  defaultMs: 0,
  calls: [] as string[],
}));
vi.mock("./agent-deletion-journal.read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-deletion-journal.read.js")>();
  return {
    ...actual,
    readAgentDeletionJournalStatusInWorker: async (agentId: string) => {
      slowDisk.calls.push(agentId);
      const delayMs = slowDisk.delays.get(agentId)?.shift() ?? slowDisk.defaultMs;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, delayMs);
        });
      }
      return "absent" as const;
    },
  };
});
// The retry backoff sleeps on node:timers/promises; route it through the faked global setTimeout.
vi.mock("node:timers/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers/promises")>();
  return {
    ...actual,
    setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => resolve(value), ms);
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

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function closeDatabases() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

beforeEach(() => {
  slowDisk.delays.clear();
  slowDisk.defaultMs = 0;
  slowDisk.calls.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await closeDatabases();
});

const flush = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/** Advances the fake clock one timer at a time until `done` holds; never reads the wall clock. */
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

/** Starts admission with the default attempt limit (120 s), as on a user's machine. */
async function startAdmission(agentIds: string[]) {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-slow-disk-") };
  const paths = new Map(
    agentIds.map((agentId) => [agentId, openBranchAgentDatabase({ agentId, env }).path]),
  );
  await closeDatabases();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const prepares = new Map(agentIds.map((agentId) => [agentId, vi.fn(async () => {})]));
  let stop: (() => Promise<void>) | undefined;
  await startup.withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: agentIds.map((agentId) => ({
        target: { agentId, path: paths.get(agentId)! },
        result: Promise.resolve({ incompatible: [], indeterminate: [] }),
      })),
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    admission.activate({
      isCurrent: () => true,
      openAgent: async () => {},
      prepareAgent: async ({ agentId }) => {
        await prepares.get(agentId)!();
      },
      replaceAgent: async () => {},
    });
  });
  const startedAt = Date.now();
  const refusal = (agentId: string) => readAgentDatabaseAdmissionRefusal(agentId, { env });
  const admitted = async (agentId: string) => {
    await runUntil(() => refusal(agentId) === undefined, `${agentId} to be admitted`);
    return Date.now() - startedAt;
  };
  return { prepares, refusal, admitted, stop: () => stop!() };
}

it("hands the lane on during one agent's slow final read, and that agent keeps its read's progress", async () => {
  // projects-manager reaches the preparation lane first; its check after preparation takes 4 min.
  slowDisk.delays.set("projects-manager", [0, 240_000]);
  slowDisk.delays.set("builder-ash", [10]);
  slowDisk.delays.set("builder-maple", [20]);
  const started = await startAdmission(["projects-manager", "builder-ash", "builder-maple"]);
  try {
    // The slow check holds the lane for at most one attempt limit (120 s), then hands it on.
    expect(await started.admitted("builder-ash")).toBeLessThan(130_000);
    expect(await started.admitted("builder-maple")).toBeLessThan(130_000);
    const managerAt = await started.admitted("projects-manager");
    expect(managerAt).toBeGreaterThanOrEqual(240_000);
    expect(managerAt).toBeLessThan(250_000);
    // Its retry joined the running read and reused the passed check before opening: 2 reads. On
    // main the retry read both again and the 4-minute read started from nothing (4 reads, ~6 min).
    expect(slowDisk.calls.filter((agentId) => agentId === "projects-manager")).toHaveLength(2);
  } finally {
    await started.stop();
  }
});

it("waits out deletion-journal reads that take longer than the attempt limit on a slow disk", async () => {
  // Every read takes 5 minutes, longer than the 120 s attempt limit.
  slowDisk.defaultMs = 300_000;
  const started = await startAdmission(["projects-manager"]);
  try {
    const admittedAfterMs = await started.admitted("projects-manager");
    // One read before opening, waited out, and one after preparation: its attempt hands the lane
    // on at the 120 s limit and the retry joins it. On main each read expired at the attempt
    // limit and started again from nothing, many times over.
    expect(slowDisk.calls).toEqual(["projects-manager", "projects-manager"]);
    expect(admittedAfterMs).toBeLessThan(2 * 300_000 + 10_000);
    // It prepared again on the retry that joined the read.
    expect(started.prepares.get("projects-manager")).toHaveBeenCalledTimes(2);
  } finally {
    await started.stop();
  }
});

it("still ends a deletion-journal read that is stuck past its maximum age, and retries it", async () => {
  // The first read never comes back within 10 minutes (5 attempt limits); the next answers.
  slowDisk.delays.set("projects-manager", [3_600_000]);
  const started = await startAdmission(["projects-manager"]);
  try {
    await runUntil(
      () => started.refusal("projects-manager")?.reason.includes("deletion-journal read") === true,
      "the stuck read to be named",
    );
    const admittedAfterMs = await started.admitted("projects-manager");
    expect(admittedAfterMs).toBeGreaterThanOrEqual(600_000);
    expect(admittedAfterMs).toBeLessThan(700_000);
  } finally {
    await started.stop();
  }
});
