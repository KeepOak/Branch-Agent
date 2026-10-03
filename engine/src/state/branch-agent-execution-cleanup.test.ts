import { afterEach, expect, it, vi } from "vitest";
import type { SqliteWorkerStore } from "../infra/sqlite-worker-contract.js";
import {
  runWithSqliteWorkerStateContext,
  type SqliteWorkerStateContext,
} from "../infra/sqlite-worker-state-context.js";
import { cleanupRetiredAgentDatabaseLease } from "./branch-agent-execution-cleanup.js";
import {
  assertBranchStateSchemaRepairAllowed,
  getExistingBranchStateSchemaPath,
} from "./branch-state-db-schema-policy.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import type { BranchStateWorkerCleanupOperations } from "./branch-state-worker-contract.js";

const edge = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  repairs: [] as Array<{ phase: string; error: unknown }>,
  forbidden: vi.fn((): never => {
    throw new Error("Cleanup schema proof crossed a native database or Worker boundary");
  }),
}));

vi.mock("node:sqlite", () => ({ DatabaseSync: edge.forbidden }));
vi.mock("node:worker_threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:worker_threads")>()),
  Worker: edge.forbidden,
}));
vi.mock("../infra/sqlite-worker-identity.js", () => ({
  readDatabasePathIdentity: async (canonicalPath: string) => ({
    key: "file:synthetic-state",
    canonicalPath,
  }),
}));
vi.mock("./branch-state-worker-store.js", () => ({
  openBranchStateWorkerCleanupStore: async (
    databasePath: string,
    context: SqliteWorkerStateContext,
  ) => {
    runWithSqliteWorkerStateContext(context, () => inspectRepairPolicy("open", databasePath));
    const store: SqliteWorkerStore<
      Pick<BranchStateWorkerCleanupOperations, "agentDatabases.releaseExitedLease">
    > = {
      async execute(command) {
        inspectRepairPolicy("cleanup", command.input.sharedStatePath);
      },
      close: edge.close,
    };
    return store;
  },
}));
vi.mock("../infra/sqlite-worker-store.js", () => ({
  runSqliteWorkerStoreOperation: async (
    store: SqliteWorkerStore<
      Pick<BranchStateWorkerCleanupOperations, "agentDatabases.releaseExitedLease">
    >,
    operation: (
      scope: SqliteWorkerStore<
        Pick<BranchStateWorkerCleanupOperations, "agentDatabases.releaseExitedLease">
      >,
    ) => Promise<void>,
    context: SqliteWorkerStateContext,
  ) => runWithSqliteWorkerStateContext(context, () => operation(store)),
}));

function inspectRepairPolicy(phase: string, databasePath: string) {
  let error: unknown;
  try {
    assertBranchStateSchemaRepairAllowed(databasePath);
  } catch (failure) {
    error = failure;
  }
  edge.repairs.push({ phase, error });
}

afterEach(() => {
  expect(edge.forbidden).not.toHaveBeenCalled();
  edge.repairs.length = 0;
  vi.clearAllMocks();
});

it("retains installed-schema repair ownership through retired agent lease cleanup", async () => {
  const databasePath = "/synthetic/state/branch.sqlite";
  const context: BranchStateWorkerContext = {
    environment: { BRANCH_STATE_DIR: "/synthetic" },
    existingSchemaPath: databasePath,
    admission: {
      coordinationKey: "file:synthetic-state",
      databasePath,
      identity: { key: "file:synthetic-state", canonicalPath: databasePath },
      assertCurrent() {},
    },
  };
  // There is no ambient schema scope for the mocked transport to inherit.
  expect(getExistingBranchStateSchemaPath()).toBeUndefined();
  await cleanupRetiredAgentDatabaseLease({
    context,
    stopped: Promise.resolve(),
    assertOwned() {},
    lease: {
      leaseId: "synthetic-lease",
      agentId: "main",
      path: "/synthetic/agents/main.sqlite",
      ownerPid: process.pid,
      ownerStartTime: null,
      sharedStatePath: databasePath,
      sharedStateIdentity: "file:synthetic-state",
    },
  });
  expect(edge.repairs).toEqual(
    ["open", "cleanup"].map((phase) => ({
      phase,
      error: expect.objectContaining({
        message: expect.stringContaining("schema repair is owned by the existing installation"),
      }),
    })),
  );
  expect(edge.close).toHaveBeenCalledOnce();
  expect(getExistingBranchStateSchemaPath()).toBeUndefined();
});
