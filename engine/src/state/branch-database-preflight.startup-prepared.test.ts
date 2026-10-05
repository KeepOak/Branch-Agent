import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import * as snapshots from "../infra/sqlite-snapshot-source.js";
import { readAgentDatabaseAdmissionRefusal } from "./agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "./agent-database-startup.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  BRANCH_AGENT_SCHEMA_VERSION,
} from "./branch-agent-db.js";
import * as schemaInspection from "./branch-agent-schema-inspection-worker.js";
import {
  assertBranchDatabasesReady,
  preflightBranchDatabaseSchemas,
} from "./branch-database-preflight.js";
import { clearBranchAgentIntegrityVerification } from "./branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    cleanup();
  });
});

function createFleet() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("preflight-startup-prepared-") };
  const agentIds = ["first", "second", "third"];
  const config: BranchConfig = {
    agents: {
      entries: Object.fromEntries(agentIds.map((id) => [id, {}])),
      defaults: { systemAgent: { agentId: "first" } },
    },
  };
  const paths = agentIds.map((agentId) => openBranchAgentDatabase({ agentId, env }).path);
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  for (const pathname of paths) {
    const database = new (requireNodeSqlite().DatabaseSync)(pathname);
    try {
      database.exec("PRAGMA journal_mode=DELETE;");
    } finally {
      database.close();
    }
  }
  const onAgentInspection = vi.fn();
  return {
    config,
    env,
    paths,
    onAgentInspection,
    ready: () =>
      assertBranchDatabasesReady({
        env,
        config,
        operation: "gateway-startup",
        onAgentInspection,
      }),
    inspect: (signal?: AbortSignal) =>
      preflightBranchDatabaseSchemas({
        env,
        signal,
        reuseStartupSchemaPreparation: true,
        onAgentInspection,
      }),
  };
}

it("skips an unconfigured system-agent database across startup passes while keeping Doctor strict", async () => {
  const fleet = createFleet();
  const leftover = openBranchAgentDatabase({ agentId: "branch", env: fleet.env }).path;
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  fs.writeFileSync(leftover, "not a configured database");
  const before = fs.readFileSync(leftover);
  await withAgentDatabaseStartupAdmission(async () => {
    await expect(fleet.ready()).resolves.toBeUndefined();
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
    );
    await expect(
      preflightBranchDatabaseSchemas({
        env: fleet.env,
        agentAdmissionConfig: fleet.config,
        reuseStartupSchemaPreparation: true,
        onAgentInspection: fleet.onAgentInspection,
      }),
    ).resolves.toEqual({ incompatible: [], indeterminate: [] });
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith({
      schemaInspectionCount: 0,
      schemaProcessCount: 0,
      schemaSnapshotCount: 0,
    });
    expect(readAgentDatabaseAdmissionRefusal("branch", { env: fleet.env })).toBeUndefined();
  });
  await expect(
    assertBranchDatabasesReady({
      env: fleet.env,
      config: fleet.config,
      operation: "doctor",
      configuredAgentDatabaseTargets: [],
    }),
  ).rejects.toThrow();
  expect(fs.readFileSync(leftover)).toEqual(before);
});

it.each(["historical", "retired shared"] as const)(
  "does not activate %s database owners",
  async (kind) => {
    const fleet = createFleet();
    const historyPath = path.join(
      fleet.env.BRANCH_STATE_DIR,
      "rollback-drill",
      "branch-agent.sqlite",
    );
    const agentId = kind === "retired shared" ? "retired" : "first";
    if (kind === "retired shared") {
      fleet.config.session = { store: historyPath };
    }
    openBranchAgentDatabase({ agentId, path: historyPath, env: fleet.env });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    clearBranchAgentIntegrityVerification(historyPath, fleet.env);
    const history = new (requireNodeSqlite().DatabaseSync)(historyPath);
    try {
      history.exec("PRAGMA journal_mode=DELETE;");
    } finally {
      history.close();
    }
    await withAgentDatabaseStartupAdmission(async () => {
      await fleet.ready();
      expect(readAgentDatabaseAdmissionRefusal("first", { env: fleet.env })).toBeUndefined();
      expect(readAgentDatabaseAdmissionRefusal(agentId, { env: fleet.env })).toBeUndefined();
    });
  },
);

it("isolates an unreadable configured path while inspecting healthy agents", async () => {
  const fleet = createFleet();
  fleet.config.agents!.entries = { broken: {}, ...fleet.config.agents!.entries };
  fs.writeFileSync(path.join(fleet.env.BRANCH_STATE_DIR, "agents", "broken"), "not a directory");
  await withAgentDatabaseStartupAdmission(async () => {
    await fleet.ready();
    expect(readAgentDatabaseAdmissionRefusal("first", { env: fleet.env })).toBeUndefined();
    expect(readAgentDatabaseAdmissionRefusal("broken", { env: fleet.env })).toMatchObject({
      code: "agent-database-inspection-failed",
      reason: expect.stringMatching(/ENOTDIR|not a directory/i),
    });
  });
});

it("keeps pending startup stores fenced without inspecting or copying them again in bootstrap", async () => {
  const fleet = createFleet();
  const pathname = fleet.paths[0]!;
  const raw = new (requireNodeSqlite().DatabaseSync)(pathname);
  raw.exec("PRAGMA journal_mode=WAL;");
  raw.close();
  const entered = createDeferred();
  const release = createDeferred();
  const createReader = schemaInspection.createAgentSchemaInspectionWorker;
  let paused = false;
  let selectedInspections = 0;
  vi.spyOn(schemaInspection, "createAgentSchemaInspectionWorker").mockImplementation(() => {
    const reader = createReader();
    const inspect = reader.inspect;
    return Object.assign(reader, {
      inspect: async (...args: Parameters<typeof inspect>) => {
        if (args[0].pathname === pathname) {
          selectedInspections += 1;
          if (!paused) {
            paused = true;
            entered.resolve();
            await release.promise;
          }
        }
        return inspect(...args);
      },
    });
  });
  const prepare = vi.spyOn(snapshots, "prepareSqliteReadOnlyLocation");
  await withAgentDatabaseStartupAdmission(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const readiness = fleet.ready();
    try {
      await entered.promise;
      await vi.advanceTimersByTimeAsync(5_000);
      await readiness;
      vi.useRealTimers();
      const refusal = readAgentDatabaseAdmissionRefusal("first", { env: fleet.env });
      expect(refusal?.code).toBe("agent-database-inspection-pending");
      expect(selectedInspections).toBe(1);

      const bootstrap = await fleet.inspect();
      expect(bootstrap.agentRefusals).toContain(refusal);
      expect(readAgentDatabaseAdmissionRefusal("first", { env: fleet.env })).toBe(refusal);
      expect(selectedInspections).toBe(1);
      expect(prepare.mock.calls.filter(([source]) => source === pathname)).toEqual([]);
    } finally {
      vi.useRealTimers();
      release.resolve();
      await Promise.allSettled([readiness]);
    }
  });
});

it("carries fleet compatibility once into bootstrap while readiness always inspects fresh", async () => {
  const fleet = createFleet();
  await withAgentDatabaseStartupAdmission(async () => {
    await fleet.ready();
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
    );
    // Migration admission before and under its lease must remain independent.
    await fleet.ready();
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
    );
    expect(await fleet.inspect()).toEqual({ incompatible: [], indeterminate: [] });
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith({
      schemaInspectionCount: 0,
      schemaProcessCount: 0,
      schemaSnapshotCount: 0,
    });
    await fleet.inspect();
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
    );
  });
  await fleet.inspect();
  expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
    expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
  );
});

it.each(["WAL commit", "replacement", "new registration"] as const)(
  "inspects only changed fleet members after %s and still refuses their newer schema",
  async (change) => {
    const fleet = createFleet();
    let changedPath = fleet.paths[0]!;
    const writer =
      change === "WAL commit" ? new (requireNodeSqlite().DatabaseSync)(changedPath) : undefined;
    writer?.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;");
    try {
      await withAgentDatabaseStartupAdmission(async () => {
        await fleet.ready();
        if (change === "WAL commit") {
          const originalMainBytes = fs.readFileSync(changedPath);
          writer!.exec(`PRAGMA user_version=${BRANCH_AGENT_SCHEMA_VERSION + 1};`);
          expect(fs.readFileSync(changedPath)).toEqual(originalMainBytes);
        } else {
          if (change === "new registration") {
            changedPath = openBranchAgentDatabase({ agentId: "newcomer", env: fleet.env }).path;
            closeBranchAgentDatabasesForTest();
            closeBranchStateDatabaseForTest();
          }
          const replacement = path.join(path.dirname(changedPath), "replacement.sqlite");
          const mutationPath = change === "replacement" ? replacement : changedPath;
          if (change === "replacement") {
            fs.copyFileSync(changedPath, replacement);
          }
          const database = new (requireNodeSqlite().DatabaseSync)(mutationPath);
          try {
            database.exec(
              `PRAGMA journal_mode=DELETE; PRAGMA user_version=${BRANCH_AGENT_SCHEMA_VERSION + 1};`,
            );
          } finally {
            database.close();
          }
          if (change === "replacement") {
            fs.renameSync(replacement, changedPath);
          }
        }
        expect(await fleet.inspect()).toMatchObject({
          incompatible: [
            {
              kind: "agent",
              path: changedPath,
              foundVersion: BRANCH_AGENT_SCHEMA_VERSION + 1,
            },
          ],
          indeterminate: [],
        });
        expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
          expect.objectContaining({ schemaInspectionCount: 1 }),
        );
      });
    } finally {
      writer?.close();
    }
  },
);

it("does not let prepared compatibility bypass cancellation or survive startup retirement", async () => {
  const fleet = createFleet();
  await withAgentDatabaseStartupAdmission(async (admission) => {
    await fleet.ready();
    const controller = new AbortController();
    const cancellation = new Error("startup cancelled after fleet admission");
    controller.abort(cancellation);
    fleet.onAgentInspection.mockClear();
    await expect(fleet.inspect(controller.signal)).rejects.toBe(cancellation);
    expect(fleet.onAgentInspection).not.toHaveBeenCalled();
    await admission.stop();
    expect(await fleet.inspect()).toEqual({ incompatible: [], indeterminate: [] });
    expect(fleet.onAgentInspection).toHaveBeenLastCalledWith(
      expect.objectContaining({ schemaInspectionCount: fleet.paths.length }),
    );
  });
});
