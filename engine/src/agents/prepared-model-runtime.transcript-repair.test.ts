// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { getPreparedModelRuntimeMocks, usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "../state/branch-database-preflight.types.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { activateGatewayAgentDatabaseStartup } from "../gateway/server-agent-database-startup.js";
import { resolveAuthProfileDatabasePath } from "./auth-profiles/sqlite.js";

const fixture = usePreparedModelRuntimeHarness({ label: "startup-transcript-repair" });
const mocks = getPreparedModelRuntimeMocks();

// The session migration hands each agent database to the caller. Drive that hand-off directly; the
// migration itself and the transcript repair it starts are the code under test.
const handoffs = vi.hoisted(() => ({ databases: [] as Array<{ agentId: string; env: NodeJS.ProcessEnv }> }));
vi.mock("../config/sessions/startup-migration.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions/startup-migration.js")>();
  return {
    ...actual,
    runSessionStartupMigration: async (params: {
      handoffDatabase?: (database: { agentId: string; env: NodeJS.ProcessEnv }) => Promise<void>;
    }) => {
      for (const database of handoffs.databases) {
        await params.handoffDatabase?.(database);
      }
    },
  };
});

// The Gateway's startup preparation refreshes the active secrets snapshot before publishing. The
// fixture supplies a snapshot whose auth store is the agent's own database.
const secrets = vi.hoisted(() => ({
  active: false,
  revision: 0,
  authDatabasePaths: [] as string[],
}));
vi.mock("../secrets/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../secrets/runtime.js")>();
  const snapshot = () => ({
    sourceConfig: {},
    authStores: secrets.authDatabasePaths.map((databasePath) => ({ databasePath })),
  });
  return {
    ...actual,
    getActiveSecretsRuntimeSnapshot: (() =>
      secrets.active
        ? snapshot()
        : actual.getActiveSecretsRuntimeSnapshot()) as typeof actual.getActiveSecretsRuntimeSnapshot,
    getActiveSecretsRuntimeSnapshotRevision: () =>
      secrets.active ? secrets.revision : actual.getActiveSecretsRuntimeSnapshotRevision(),
    refreshActiveSecretsRuntimeSnapshotForConfig: (async (
      params: Parameters<typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig>[0],
    ) => {
      if (!secrets.active) {
        return await actual.refreshActiveSecretsRuntimeSnapshotForConfig(params);
      }
      params.assertCurrent?.();
      secrets.revision += 1;
      return true;
    }) as typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig,
  };
});

// The transcript repair is held open by the test until it resolves it.
const repair = vi.hoisted(() => ({
  pending: undefined as Promise<{ reconciledSessions: number }> | undefined,
  calls: 0,
}));
vi.mock("../config/sessions/session-transcript-reconcile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions/session-transcript-reconcile.js")>();
  return {
    ...actual,
    reconcileSessionTranscriptIndexes: async () => {
      repair.calls += 1;
      return await repair.pending!;
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

// The roster must own "tk": inspection and preparation resolve its database path from the config.
const config = { agents: { entries: { tk: {} } } } as BranchConfig;

it("admits an agent while its transcript repair is still pending, then runs the repair once", async () => {
  mocks.configuredAgentIds = ["tk"];
  secrets.authDatabasePaths = [resolveAuthProfileDatabasePath(fixture.state.agentDir("tk"))];
  secrets.active = true;
  const env = {
    BRANCH_STATE_DIR: tempDirs.make("startup-transcript-repair-"),
    BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
    BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "60000",
  };
  const path = openBranchAgentDatabase({ agentId: "tk", env }).path;
  await closeDatabases();
  handoffs.databases = [{ agentId: "tk", env }];
  const held = Promise.withResolvers<{ reconciledSessions: number }>();
  repair.pending = held.promise;
  repair.calls = 0;
  const tracked: Promise<void>[] = [];
  const trace: string[] = [];
  const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
  let stop: (() => Promise<void>) | undefined;
  try {
    await withAgentDatabaseStartupAdmission(async (admission) => {
      const refusals = admission.defer({
        env,
        inspections: [{ target: { agentId: "tk", path }, result: Promise.resolve(clean) }],
        reason: "Inspection continues after the Gateway listener binds.",
      });
      recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
      stop = admission.adopt().stop;
      // The Gateway's own activation, with its real prepareAgent; only openAgent is skipped.
      activateGatewayAgentDatabaseStartup({
        admission: {
          activate: (activation: Parameters<typeof admission.activate>[0]) =>
            admission.activate({ ...activation, openAgent: async () => {} }),
        } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
        preparationReady: Promise.resolve(),
        waitForPostReadyWork: async () => {},
        trackDeferredWork: (run) => {
          tracked.push(run());
        },
        getConfig: () => config,
        getPluginRegistry: () => createEmptyPluginRegistry(),
        getPluginMetadataSnapshot: () => undefined,
        isCurrent: () => true,
        log: {
          info: (message: string) => trace.push(`info: ${message}`),
          warn: (message: string) => trace.push(`warn: ${message}`),
        },
      });
    });
    // Admission completes while the repair is still held open.
    await expect
      .poll(
        () => ({
          reason: readAgentDatabaseAdmissionRefusal("tk", { env })?.reason,
          repairCalls: repair.calls,
          trace,
        }),
        { timeout: 8000 },
      )
      .toEqual({ reason: undefined, repairCalls: expect.any(Number), trace: expect.anything() });
    await expect.poll(() => repair.calls, { timeout: 10000 }).toBe(1);
    // Resolve the repair and assert it ran exactly once.
    held.resolve({ reconciledSessions: 0 });
    await Promise.all(tracked);
    expect(repair.calls).toBe(1);
  } finally {
    // Release the held repair so a failing run still shuts down.
    held.resolve({ reconciledSessions: 0 });
    secrets.active = false;
    await stop?.();
  }
});
