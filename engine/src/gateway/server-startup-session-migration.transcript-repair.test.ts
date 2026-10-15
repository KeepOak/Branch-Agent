import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchAgentDatabaseOptions } from "../state/branch-agent-db.js";
import {
  runDeferredTranscriptRepair,
  runStartupSessionMigration,
} from "./server-startup-session-migration.js";

// The session migration hands each agent database to the caller. Drive that hand-off directly.
const handoffs = vi.hoisted(() => ({ databases: [] as BranchAgentDatabaseOptions[] }));
vi.mock("../config/sessions/startup-migration.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions/startup-migration.js")>();
  return {
    ...actual,
    runSessionStartupMigration: async (params: {
      handoffDatabase?: (database: BranchAgentDatabaseOptions) => Promise<void>;
    }) => {
      for (const database of handoffs.databases) {
        await params.handoffDatabase?.(database);
      }
    },
  };
});

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const cfg = {} as BranchConfig;

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("startup transcript repair", () => {
  it("defers a handed-off agent database's transcript repair until it is run", async () => {
    const database = { agentId: "tk", env: { BRANCH_STATE_DIR: tempDirs.make("transcript-repair-") } };
    handoffs.databases = [database];
    const reconcile = vi.fn(async () => ({ reconciledSessions: 2 }));
    const deps = { reconcileSessionTranscriptIndexes: reconcile as never };
    const log = fakeLog();
    const deferred: BranchAgentDatabaseOptions[] = [];

    await runStartupSessionMigration({
      cfg,
      log: log as never,
      deps,
      deferTranscriptRepair: (pending) => deferred.push(pending),
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(deferred).toEqual([database]);

    await runDeferredTranscriptRepair({ databases: deferred, log: log as never, deps });

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(database);
    expect(log.info).toHaveBeenCalledWith(
      "session: rebuilt 2 transcript projection(s) after agent admission",
    );
  });

  it("still repairs inline when no deferral is requested", async () => {
    handoffs.databases = [{ agentId: "tk", env: { BRANCH_STATE_DIR: tempDirs.make("transcript-inline-") } }];
    const reconcile = vi.fn(async () => ({ reconciledSessions: 1 }));

    await runStartupSessionMigration({
      cfg,
      log: fakeLog() as never,
      deps: { reconcileSessionTranscriptIndexes: reconcile as never },
    });

    expect(reconcile).toHaveBeenCalledOnce();
  });
});
