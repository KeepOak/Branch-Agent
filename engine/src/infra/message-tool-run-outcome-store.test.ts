import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  getBranchAgentDatabaseIfOpen,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { resolveIncognitoBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import { runBranchAgentWriteAdmission } from "../state/branch-agent-write-admission.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { recordMessageToolRunOutcome } from "./message-tool-run-outcome-store.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function createEnv(): NodeJS.ProcessEnv {
  return { BRANCH_STATE_DIR: tempDirs.make("branch-message-tool-outcome-") };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
});

describe("message-tool run outcome store", () => {
  it.each([false, true])(
    "records durable outcomes without caller-thread SQL (custom=%s)",
    async (custom) => {
      const env = createEnv();
      const storePath = custom ? path.join(env.BRANCH_STATE_DIR!, "custom.sqlite") : undefined;
      const database = openBranchAgentDatabase({ agentId: "main", env, path: storePath });
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(() => {
        throw new Error("SQL ran on the caller");
      });
      const exec = vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => {
        throw new Error("SQL ran on the caller");
      });
      try {
        await recordMessageToolRunOutcome({
          runId: "worker-boundary",
          sessionKey: "agent:main:main",
          agentId: "main",
          provider: "openai",
          model: "gpt-5.6-luna",
          outcome: "tool_delivered",
          runStatus: "completed",
          occurredAt: 100,
          storePath,
          env,
        });
      } finally {
        prepare.mockRestore();
        exec.mockRestore();
      }
      expect(database.db.prepare("SELECT run_id FROM message_tool_run_outcomes").all()).toEqual([
        { run_id: "worker-boundary" },
      ]);
    },
  );

  it("lazily records typed completion facts in an existing same-version database", async () => {
    const env = createEnv();
    const database = openBranchAgentDatabase({ agentId: "main", env });
    database.db.exec("DROP TABLE message_tool_run_outcomes;");
    closeBranchAgentDatabasesForTest();

    for (const [runId, outcome, runStatus] of [
      ["run-delivered", "tool_delivered", "completed"],
      ["run-mute", "mute", "completed"],
      ["run-error", "mute", "errored"],
    ] as const) {
      await recordMessageToolRunOutcome({
        runId,
        sessionKey: "agent:main:main",
        agentId: "main",
        provider: "openai",
        model: "gpt-5.6-luna",
        outcome,
        runStatus,
        occurredAt: 100,
        env,
      });
    }

    const db = openBranchAgentDatabase({ agentId: "main", env }).db;
    db.exec(`CREATE TRIGGER refuse_outcome BEFORE INSERT ON message_tool_run_outcomes
      WHEN NEW.run_id = 'refused' BEGIN SELECT RAISE(ABORT, 'outcome refused'); END;`);
    await expect(
      recordMessageToolRunOutcome({
        runId: "refused",
        sessionKey: "agent:main:main",
        agentId: "main",
        provider: "openai",
        model: "gpt-5.6-luna",
        outcome: "mute",
        runStatus: "errored",
        occurredAt: 100,
        env,
      }),
    ).rejects.toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 1811 });

    expect(
      openBranchAgentDatabase({ agentId: "main", env })
        .db.prepare("SELECT run_id, outcome, run_status FROM message_tool_run_outcomes ORDER BY id")
        .all(),
    ).toEqual([
      { run_id: "run-delivered", outcome: "tool_delivered", run_status: "completed" },
      { run_id: "run-mute", outcome: "mute", run_status: "completed" },
      { run_id: "run-error", outcome: "mute", run_status: "errored" },
    ]);
  });

  it("prunes the per-agent operational history to 10,000 newest rows", async () => {
    const env = createEnv();
    const database = openBranchAgentDatabase({ agentId: "main", env });
    database.db.exec(`
      WITH RECURSIVE rows(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM rows WHERE value <= 10000
      )
      INSERT INTO message_tool_run_outcomes (
        run_id, session_key, agent_id, provider, model, outcome, run_status, occurred_at
      )
      SELECT
        'seed-' || value, 'agent:main:main', 'main', 'openai', 'gpt-5.6-luna',
        'mute', 'completed', value / 2
      FROM rows;
    `);

    await recordMessageToolRunOutcome({
      runId: "newest",
      sessionKey: "agent:main:main",
      agentId: "main",
      provider: "openai",
      model: "gpt-5.6-luna",
      outcome: "tool_delivered",
      runStatus: "completed",
      occurredAt: 20_000,
      env,
    });

    expect(
      database.db
        .prepare(
          "SELECT COUNT(*) AS count, MIN(occurred_at) AS oldest, MAX(occurred_at) AS newest FROM message_tool_run_outcomes",
        )
        .get(),
    ).toEqual({ count: 10_000, oldest: 1, newest: 20_000 });
    expect(
      database.db
        .prepare("SELECT run_id FROM message_tool_run_outcomes ORDER BY occurred_at, id LIMIT 1")
        .get(),
    ).toEqual({ run_id: "seed-3" });
  });

  it("preserves FIFO against other agent writes and captures queued inputs", async () => {
    const env = createEnv();
    const target = { agentId: "main", env };
    const db = openBranchAgentDatabase(target).db;
    const gate = createDeferredCore();
    const ahead = runBranchAgentWriteAdmission(target, () => gate.promise);
    const input = {
      ...target,
      runId: "first",
      sessionKey: "agent:main:main",
      provider: "openai",
      model: "gpt-5.6-luna",
      outcome: "mute" as const,
      runStatus: "completed" as const,
      occurredAt: 100,
    };
    const first = recordMessageToolRunOutcome(input);
    const between = runBranchAgentWriteAdmission(target, () =>
      db.prepare("SELECT run_id FROM message_tool_run_outcomes ORDER BY id").all(),
    );
    const second = recordMessageToolRunOutcome({ ...input, runId: "second" });
    input.runId = "mutated";
    input.sessionKey = "agent:main:changed";
    env.BRANCH_STATE_DIR = tempDirs.make("branch-message-tool-unselected-");
    gate.resolve();
    await Promise.all([ahead, first, second]);
    expect(await between).toEqual([{ run_id: "first" }]);
    expect(
      db.prepare("SELECT run_id, session_key FROM message_tool_run_outcomes ORDER BY id").all(),
    ).toEqual([
      { run_id: "first", session_key: "agent:main:main" },
      { run_id: "second", session_key: "agent:main:main" },
    ]);
  });

  it("refuses queued recording after close instead of opening a successor", async () => {
    const env = createEnv();
    const target = { agentId: "main", env };
    openBranchAgentDatabase(target);
    const gate = createDeferredCore();
    const ahead = runBranchAgentWriteAdmission(target, () => gate.promise);
    const pending = recordMessageToolRunOutcome({
      ...target,
      runId: "closed",
      sessionKey: "agent:main:main",
      provider: "openai",
      model: "gpt-5.6-luna",
      outcome: "mute",
      runStatus: "aborted",
      occurredAt: 100,
    });
    const refused = expect(pending).rejects.toThrow(/revoked|closed/);
    try {
      await closeBranchAgentDatabasesAsync();
    } finally {
      gate.resolve();
    }
    await ahead;
    await refused;
    expect(getBranchAgentDatabaseIfOpen(target)).toBeUndefined();
  });

  it("keeps incognito outcomes on their process-held owner", async () => {
    const env = createEnv();
    const target = { agentId: "main", env };
    await recordMessageToolRunOutcome({
      ...target,
      runId: "private",
      sessionKey: "agent:main:dashboard:incognito-outcome",
      provider: "openai",
      model: "gpt-5.6-luna",
      outcome: "mute",
      runStatus: "aborted",
      occurredAt: 100,
    });
    const privateDb = getBranchAgentDatabaseIfOpen({
      ...target,
      path: resolveIncognitoBranchAgentSqlitePath(target),
    });
    expect(privateDb?.db.prepare("SELECT run_id FROM message_tool_run_outcomes").all()).toEqual([
      { run_id: "private" },
    ]);
    expect(getBranchAgentDatabaseIfOpen(target)).toBeUndefined();
  });
});
