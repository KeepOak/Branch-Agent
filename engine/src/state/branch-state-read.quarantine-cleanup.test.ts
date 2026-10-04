import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type {
  BranchStateReadReply,
  BranchStateReadRequest,
} from "./branch-state-read.types.js";

type FakeDatabase = {
  isOpen: boolean;
  exec: () => void;
  prepare: (sql: string) => { get: () => unknown };
  close: () => void;
};
const mock = vi.hoisted(() => ({
  handler: vi.fn<(input: unknown) => BranchStateReadReply>(),
  open: vi.fn<(location: string) => FakeDatabase>(),
  read: vi.fn<(sql: string) => unknown>(),
  close: vi.fn<() => void>(),
  query: vi.fn<() => []>(),
  claimAgentLease: vi.fn(() => "quarantine-test-lease"),
  databases: [] as FakeDatabase[],
}));
vi.mock("../infra/worker-task-server.js", () => ({
  serveOwnedWorkerTasks: (handler: (input: unknown) => BranchStateReadReply) => {
    mock.handler.mockImplementation(handler);
  },
}));
vi.mock("../infra/node-sqlite.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/node-sqlite.js")>()),
  openNodeSqliteDatabase: mock.open,
}));
vi.mock("../fleet/registry.kernel.js", () => ({
  listFleetCellsInDatabase: mock.query,
  getFleetCellInDatabase: () => undefined,
}));
vi.mock("./branch-agent-db-lease.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./branch-agent-db-lease.js")>()),
  claimBranchAgentDatabaseLease: mock.claimAgentLease,
  releaseBranchAgentDatabaseLease: vi.fn(),
}));
vi.mock("./branch-state-db-read-connection.js", () => ({
  closeRetainedBranchStateReadConnections: vi.fn(),
  withBranchStateReadOnlyLocation: (operation: (source: { db: object }) => unknown) =>
    operation({ db: {} }),
}));

import "./branch-state-read.worker.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchAgentDatabasesForTest());
beforeEach(() => {
  mock.databases.length = 0;
  mock.read.mockReset().mockReturnValue({ user_version: 0 });
  mock.close.mockReset();
  mock.query.mockReset().mockReturnValue([]);
  mock.claimAgentLease.mockClear();
  mock.open.mockReset().mockImplementation((location) => {
    if (!location.endsWith("branch-quarantine.sqlite")) {
      throw new Error(`Unexpected source database open: ${location}`);
    }
    const database: FakeDatabase = {
      isOpen: true,
      exec() {},
      prepare: (sql) => ({ get: () => mock.read(sql) }),
      close() {
        mock.close();
        database.isOpen = false;
      },
    };
    mock.databases.push(database);
    return database;
  });
});

function request(): BranchStateReadRequest {
  const root = tempDirs.make("branch-quarantine-cleanup-");
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  // Only existence/identity are real; every SQLite connection is a plain mocked object.
  fs.writeFileSync(path.join(state, "branch-quarantine.sqlite"), "mock quarantine store");
  const databasePath = path.join(state, "branch.sqlite");
  fs.writeFileSync(databasePath, "mock state source");
  return {
    context: {
      environment: { BRANCH_STATE_DIR: root },
    },
    databasePath,
    location: databasePath,
    checkFreshAdmission: true,
    command: { type: "fleet.list" },
  };
}

function knownQuarantine(kind: "state" | "agent") {
  const reason = "verified synthetic database damage";
  mock.read.mockImplementation((sql) =>
    sql === "PRAGMA user_version"
      ? { user_version: 2 }
      : { kind, reason, quarantined_at: 1, verified_generation: null },
  );
  return reason;
}

it.each([
  { known: true, readFails: false, closeFails: false },
  { known: true, readFails: false, closeFails: true },
  { known: false, readFails: false, closeFails: true },
  { known: false, readFails: true, closeFails: true },
  { known: false, readFails: true, closeFails: false },
])("preserves quarantine decisions and cleanup facts (%j)", ({ known, readFails, closeFails }) => {
  const input = request();
  const reason = known ? knownQuarantine("state") : undefined;
  const readFailure = new Error("quarantine metadata read failed");
  const closeFailure = new Error("quarantine native reader close failed");
  if (readFails) {
    mock.read.mockImplementationOnce(() => {
      throw readFailure;
    });
  }
  if (closeFails) {
    mock.close.mockImplementationOnce(() => {
      throw closeFailure;
    });
  }
  const reply = mock.handler(input);
  if (known) {
    expect(reply).toMatchObject({ ok: false, message: expect.stringContaining(reason!) });
    expect(reply).not.toHaveProperty("sourceAdmitted", true);
  } else if (closeFails) {
    expect(reply).toMatchObject({ ok: true, type: "fleet.list", cells: [] });
  } else {
    expect(reply).toEqual({ ok: true, type: "fleet.list", sourceAdmitted: true, cells: [] });
  }
  if (closeFails) {
    expect(reply.nativeCleanupFailure?.error?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: closeFailure.message }),
        ...(readFails ? [expect.objectContaining({ message: readFailure.message })] : []),
      ]),
    );
  } else {
    expect(reply.nativeCleanupFailure).toBeUndefined();
  }
  expect(mock.query).toHaveBeenCalledTimes(known ? 0 : 1);
  expect(mock.close).toHaveBeenCalledOnce();
  expect(mock.databases[0]?.isOpen).toBe(closeFails);
});

it("latches a known agent quarantine when metadata cleanup fails before source activation", () => {
  const input = request();
  const reason = knownQuarantine("agent");
  const closeFailure = new Error("agent quarantine reader close failed after a valid decision");
  mock.close.mockImplementationOnce(() => {
    throw closeFailure;
  });
  const agentPath = path.join(path.dirname(input.databasePath), "branch-agent.sqlite");
  fs.writeFileSync(agentPath, "mock agent source");
  const options = { agentId: "quarantined-agent", path: agentPath, env: input.context.environment };
  let failure: unknown;
  try {
    openBranchAgentDatabase(options);
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error);
  expect(failure).toMatchObject({
    name: "SqliteIntegrityError",
    message: expect.stringContaining(reason),
    cause: { errors: [closeFailure] },
  });
  expect(mock.claimAgentLease).not.toHaveBeenCalled();
  expect(mock.open).toHaveBeenCalledOnce();
  expect(mock.close).toHaveBeenCalledOnce();

  mock.open.mockClear();
  expect(() => openBranchAgentDatabase(options)).toThrow(failure);
  expect(mock.open).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps agent cleanup failures retryable without a validated decision (read also fails=%s)",
  (readFails) => {
    const input = request();
    const readFailure = new Error("agent quarantine metadata unavailable");
    const closeFailure = new Error("agent quarantine reader close failed");
    if (readFails) {
      mock.read.mockImplementation(() => {
        throw readFailure;
      });
    }
    mock.close.mockImplementation(() => {
      throw closeFailure;
    });
    const agentPath = path.join(path.dirname(input.databasePath), "branch-agent.sqlite");
    fs.writeFileSync(agentPath, "mock agent source");
    const options = { agentId: "retryable-agent", path: agentPath, env: input.context.environment };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let failure: unknown;
      try {
        openBranchAgentDatabase(options);
      } catch (error) {
        failure = error;
      }
      assert(failure instanceof AggregateError);
      expect(failure.name).toBe("BranchQuarantineReadCleanupError");
      expect(failure.errors).toEqual([...(readFails ? [readFailure] : []), closeFailure]);
      expect(failure.cause).toBe(readFails ? readFailure : closeFailure);
    }
    expect(mock.open).toHaveBeenCalledTimes(2);
    expect(mock.close).toHaveBeenCalledTimes(2);
    expect(mock.claimAgentLease).not.toHaveBeenCalled();
  },
);
