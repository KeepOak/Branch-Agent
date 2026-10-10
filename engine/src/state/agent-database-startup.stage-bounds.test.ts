import { afterEach, describe, expect, it, vi } from "vitest";
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

// Stall switches for the two pre-prepare stages that have no seam of their own. Each stall applies to
// the next call only, and the real implementation runs otherwise.
const stalls = vi.hoisted(() => ({ deletionJournalRead: false, openingPermit: false }));

vi.mock("./agent-deletion-journal.read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-deletion-journal.read.js")>();
  return {
    ...actual,
    readAgentDeletionJournalStatusInWorker: (
      ...args: Parameters<typeof actual.readAgentDeletionJournalStatusInWorker>
    ) => {
      if (stalls.deletionJournalRead) {
        stalls.deletionJournalRead = false;
        return new Promise<never>(() => {});
      }
      return actual.readAgentDeletionJournalStatusInWorker(...args);
    },
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
        acquire: (options?: Parameters<typeof pool.acquire>[0]) => {
          if (stalls.openingPermit) {
            stalls.openingPermit = false;
            return new Promise<never>(() => {});
          }
          return pool.acquire(options);
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
afterEach(closeDatabases);

const CLEAN: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
const NEVER = (): Promise<BranchDatabaseSchemaPreflight> => new Promise(() => {});

type Agent = {
  agentId: string;
  inspection?: Promise<BranchDatabaseSchemaPreflight>;
  prepareAgent?: (input: { signal: AbortSignal }) => Promise<void>;
};

/** Starts startup preparation for the given agents in one admission, with a short watchdog and retry. */
async function startAdmission(
  agents: Agent[],
  extraEnv: Record<string, string>,
  open: () => Promise<void> = async () => {},
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
  // Arm a stall only now, so it cannot be spent on a permit taken while the databases were opened.
  armStall();
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
        result: inspection ?? Promise.resolve(CLEAN),
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
    vi.waitFor(() => expect(refusal(agentId)).toBeUndefined(), { timeout: 10000 });
  return { agentId: agents[0]!.agentId, env, prepares, openAgent, refusal, admitted, stop: stop! };
}

describe("agent database startup stages that could hang", () => {
  it("names a stage that is still waiting for its inspection, and keeps waiting while it has not finished", async () => {
    const started = await startAdmission([{ agentId: "tk", inspection: NEVER() }], {});
    try {
      await vi.waitFor(
        () => expect(started.refusal("tk")?.reason).toContain("Stage: inspection."),
        { timeout: 5000 },
      );
      expect(started.openAgent).not.toHaveBeenCalled();
      expect(started.prepares.get("tk")).not.toHaveBeenCalled();
      // Still pending, and the reason stays on the inspection stage rather than going silent.
      expect(started.refusal("tk")).toMatchObject({
        code: "agent-database-inspection-pending",
      });
    } finally {
      await started.stop();
    }
  });

  it("ends a hung openAgent at its limit, names the open stage, and retries it", async () => {
    let calls = 0;
    const started = await startAdmission([{ agentId: "tk" }], {}, async () => {
      calls += 1;
      if (calls === 1) {
        // Ignores its abort signal, so only the stage limit can end this call.
        await new Promise(() => {});
      }
    });
    try {
      await started.admitted("tk");
      expect(started.openAgent.mock.calls.length).toBeGreaterThanOrEqual(2);
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
        stalls.deletionJournalRead = true;
      },
    );
    try {
      await vi.waitFor(
        () => expect(started.refusal("tk")?.reason).toContain("deletion-journal read"),
        { timeout: 5000 },
      );
      await started.admitted("tk");
      expect(started.prepares.get("tk")).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop();
    }
  });

  // The retry waits 400ms so the stage stays visible on the refusal long enough to observe it.
  it("ends a stalled opening permit at its limit, names the stage, and retries it", async () => {
    const started = await startAdmission(
      [{ agentId: "tk" }],
      { BRANCH_AGENT_PREPARATION_RETRY_MS: "400" },
      undefined,
      () => {
        stalls.openingPermit = true;
      },
    );
    try {
      await vi.waitFor(
        () => expect(started.refusal("tk")?.reason).toContain("opening permit"),
        { timeout: 5000 },
      );
      await started.admitted("tk");
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
});
