// Goal tool tests cover goal accounting projection and correct session-store
// routing for global and scoped sessions.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { resolveSessionStorePathCore } from "../../config/sessions/paths.js";
import {
  loadSessionEntry,
  upsertSessionEntryCore as upsertAccessorSessionEntry,
} from "../../config/sessions/session-accessor.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { createCreateGoalTool, createGetGoalTool, createUpdateGoalTool } from "./goal-tools.js";

async function createStoreConfig(): Promise<{ config: BranchConfig; template: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-goal-tools-"));
  const template = path.join(dir, "{agentId}", "sessions.json");
  return {
    config: { session: { store: template } } as BranchConfig,
    template,
  };
}

// Goal tools read/write through the SQLite-backed accessor, so test fixtures
// must seed and assert through the same boundary.
function getSessionEntry(params: {
  storePath: string;
  sessionKey: string;
}): SessionEntry | undefined {
  return loadSessionEntry(params);
}

async function upsertSessionEntry(params: {
  storePath: string;
  sessionKey: string;
  entry: SessionEntry;
}): Promise<void> {
  await upsertAccessorSessionEntry(
    { sessionKey: params.sessionKey, storePath: params.storePath },
    params.entry,
  );
}

describe("goal tools", () => {
  it("recovers saved progress and requires evidence for every declared criterion", async () => {
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    const options = { agentSessionKey: "global", sessionAgentId: "research", config };
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: { sessionId: "recovery", updatedAt: 1 },
    });
    const created = await createCreateGoalTool(options).execute("create", {
      objective: "Write and verify the report",
      acceptance_criteria: ["Report written", "Report checked"],
    });
    const goalId = (created.details as { goal: { id: string } }).goal.id;
    await createUpdateGoalTool(options).execute("checkpoint", {
      status: "checkpoint",
      goal_id: goalId,
      note: "Report written at report.md",
      next_action: "Check its contents, then deliver it",
    });
    // Reconstruct all tools and read from the actual SQLite session boundary.
    const recovered = await createGetGoalTool({ ...options }).execute("read-after-restart", {});
    expect(recovered.details).toMatchObject({
      goal: {
        id: goalId,
        status: "active",
        acceptanceCriteria: ["Report written", "Report checked"],
        checkpoint: {
          summary: "Report written at report.md",
          nextAction: "Check its contents, then deliver it",
        },
      },
    });
    const premature = await createUpdateGoalTool(options).execute("premature", {
      status: "complete",
      goal_id: goalId,
      completion_evidence: [{ criterion: 0, evidence: "write receipt" }],
    });
    expect(premature.details).toMatchObject({
      status: "error",
      error: expect.stringContaining("every acceptance criterion"),
    });
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.status).toBe("active");
    const completed = await createUpdateGoalTool(options).execute("complete", {
      status: "complete",
      goal_id: goalId,
      completion_evidence: [
        { criterion: 0, evidence: "write receipt: report.md" },
        { criterion: 1, evidence: "validation receipt: passed" },
      ],
    });
    expect(completed.details).toMatchObject({
      status: "updated",
      goal: {
        status: "complete",
        completionEvidence: expect.arrayContaining([
          { criterion: 1, evidence: "validation receipt: passed" },
        ]),
      },
    });
    await createUpdateGoalTool(options).execute("completion-retry", {
      status: "complete",
      goal_id: goalId,
      completion_evidence: [
        { criterion: 0, evidence: "replacement claim" },
        { criterion: 1, evidence: "replacement claim" },
      ],
    });
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.completionEvidence).toEqual([
      { criterion: 0, evidence: "write receipt: report.md" },
      { criterion: 1, evidence: "validation receipt: passed" },
    ]);
  });

  it("refuses a stale checkpoint or completion after the goal is replaced", async () => {
    const { clearSessionGoal } = await import("../../config/sessions/goals.js");
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    const options = { agentSessionKey: "global", sessionAgentId: "research", config };
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: { sessionId: "replacement", updatedAt: 1 },
    });
    const old = await createCreateGoalTool(options).execute("old", { objective: "Old task" });
    const oldId = (old.details as { goal: { id: string } }).goal.id;
    await clearSessionGoal({ storePath, sessionKey: "global", agentId: "research" });
    await createCreateGoalTool(options).execute("new", { objective: "New task" });
    for (const status of ["checkpoint", "complete"] as const) {
      const result = await createUpdateGoalTool(options).execute("stale", {
        status,
        goal_id: oldId,
        note: "Old work",
        next_action: "Finish old work",
      });
      expect(result.details).toMatchObject({
        status: "error",
        error: expect.stringContaining("Goal changed"),
      });
    }
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal).toMatchObject({
      objective: "New task",
      status: "active",
    });
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.checkpoint).toBeUndefined();
  });

  it("rejects whitespace criteria and malformed evidence before modifying the goal", async () => {
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    const options = { agentSessionKey: "global", sessionAgentId: "research", config };
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: { sessionId: "validation", updatedAt: 1 },
    });
    await expect(
      createCreateGoalTool(options).execute("invalid", {
        objective: "Ship",
        acceptance_criteria: [" "],
      }),
    ).rejects.toThrow("non-empty");
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal).toBeUndefined();
    await createCreateGoalTool(options).execute("valid", {
      objective: "Ship",
      acceptance_criteria: ["Verified"],
    });
    await expect(
      createUpdateGoalTool(options).execute("invalid", {
        status: "complete",
        completion_evidence: [{ criterion: 0.5, evidence: "claim" }],
      }),
    ).rejects.toThrow("criterion indexes");
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.status).toBe("active");
  });

  it("keeps get_goal read-only when accounting changes are projected", async () => {
    // Budget-limited status can be derived for display without mutating the
    // stored active goal record.
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: {
        sessionId: "sess-global",
        updatedAt: 1,
        totalTokens: 125,
        totalTokensFresh: true,
        totalTokensVersion: 1,
        goal: {
          schemaVersion: 1,
          id: "goal-1",
          objective: "ship",
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          tokenStart: 100,
          tokenStartFresh: true,
          tokensUsed: 0,
          tokenBudget: 20,
          continuationTurns: 0,
        },
      },
    });
    const tool = createGetGoalTool({
      agentSessionKey: "global",
      runSessionKey: "global",
      sessionAgentId: "research",
      config,
    });

    const result = await tool.execute("call-1", {});

    expect((result.details as { goal?: { status?: string } }).goal?.status).toBe("budget_limited");
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.status).toBe("active");
  });

  it.each([undefined, null, 100])("creates a scoped goal with token_budget=%s", async (budget) => {
    const { config, template } = await createStoreConfig();
    const tool = createCreateGoalTool({
      agentSessionKey: "global",
      runSessionKey: "global",
      sessionAgentId: "research",
      config,
    });

    const researchStorePath = resolveSessionStorePathCore(template, { agentId: "research" });
    await upsertSessionEntry({
      storePath: researchStorePath,
      sessionKey: "global",
      entry: { sessionId: "sess-global", updatedAt: 1 },
    });
    const args = {
      objective: "ship global work",
      ...(budget !== undefined ? { token_budget: budget } : {}),
    };
    expect(Value.Check(tool.parameters, args)).toBe(true);
    await tool.execute("call-1", args);

    const mainStorePath = resolveSessionStorePathCore(template, { agentId: "main" });
    expect(
      getSessionEntry({ storePath: researchStorePath, sessionKey: "global" })?.goal?.objective,
    ).toBe("ship global work");
    expect(
      getSessionEntry({ storePath: researchStorePath, sessionKey: "global" })?.goal?.tokenBudget,
    ).toBe(budget ?? undefined);
    expect(
      getSessionEntry({ storePath: mainStorePath, sessionKey: "global" })?.goal,
    ).toBeUndefined();
  });

  it.each(["42.9", "1abc", 0])(
    "rejects invalid token budgets before creating a goal: %s",
    async (tokenBudget) => {
      const { config, template } = await createStoreConfig();
      const tool = createCreateGoalTool({
        agentSessionKey: "global",
        runSessionKey: "global",
        sessionAgentId: "research",
        config,
      });

      const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
      await upsertSessionEntry({
        storePath,
        sessionKey: "global",
        entry: { sessionId: "sess-global", updatedAt: 1 },
      });
      await expect(
        tool.execute("call-invalid-budget", {
          objective: "ship global work",
          token_budget: tokenBudget,
        }),
      ).rejects.toThrow("token_budget must be a positive integer");

      expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal).toBeUndefined();
    },
  );

  it("prefers scoped run session keys over the fallback session agent", async () => {
    const { config, template } = await createStoreConfig();
    const tool = createCreateGoalTool({
      agentSessionKey: "global",
      runSessionKey: "agent:ops:main",
      sessionAgentId: "research",
      config,
    });

    const opsStorePath = resolveSessionStorePathCore(template, { agentId: "ops" });
    await upsertSessionEntry({
      storePath: opsStorePath,
      sessionKey: "agent:ops:main",
      entry: { sessionId: "sess-ops", updatedAt: 1 },
    });
    await tool.execute("call-1", { objective: "ship ops work" });

    const researchStorePath = resolveSessionStorePathCore(template, { agentId: "research" });
    expect(
      getSessionEntry({ storePath: opsStorePath, sessionKey: "agent:ops:main" })?.goal?.objective,
    ).toBe("ship ops work");
    expect(
      getSessionEntry({ storePath: researchStorePath, sessionKey: "agent:ops:main" })?.goal,
    ).toBeUndefined();
  });

  it("tells the model to send the requested final reply after completing a goal", async () => {
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    const options = {
      agentSessionKey: "global",
      runSessionKey: "global",
      sessionAgentId: "research",
      config,
    };
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: { sessionId: "sess-global", updatedAt: 1 },
    });
    await createCreateGoalTool(options).execute("call-create", {
      objective: "Write the artifact and reply GOAL-DONE",
    });

    const tool = createUpdateGoalTool(options);
    const result = await tool.execute("call-complete", { status: "complete" });

    expect(tool.description).toContain("does not reply to the user");
    expect(result.details).toMatchObject({
      status: "updated",
      goal: { status: "complete" },
      nextAction: expect.stringContaining("provide the requested visible final response"),
    });
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("provide the requested visible final response"),
      }),
    ]);
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal?.status).toBe("complete");
  });

  it("returns actionable guidance instead of throwing when no goal exists", async () => {
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: { sessionId: "sess-global", updatedAt: 1 },
    });
    const tool = createUpdateGoalTool({
      agentSessionKey: "global",
      runSessionKey: "global",
      sessionAgentId: "research",
      config,
    });

    const result = await tool.execute("call-no-goal", { status: "blocked" });

    expect(result.details).toMatchObject({
      status: "error",
      error: "goal not found",
      nextAction: expect.stringContaining("Do not retry update_goal"),
    });
    expect((result.details as { nextAction?: string }).nextAction).toContain(
      "provide your response to the user",
    );
    expect(result.content).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Do not retry update_goal"),
      }),
    ]);
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal).toBeUndefined();
  });

  it("returns actionable guidance when goal is already complete", async () => {
    const { config, template } = await createStoreConfig();
    const storePath = resolveSessionStorePathCore(template, { agentId: "research" });
    const options = {
      agentSessionKey: "global",
      runSessionKey: "global",
      sessionAgentId: "research",
      config,
    };
    await upsertSessionEntry({
      storePath,
      sessionKey: "global",
      entry: {
        sessionId: "sess-global",
        updatedAt: 1,
        goal: {
          schemaVersion: 1,
          id: "goal-1",
          objective: "ship",
          status: "complete",
          createdAt: 1,
          updatedAt: 1,
          tokenStart: 0,
          tokenStartFresh: true,
          tokensUsed: 10,
          continuationTurns: 0,
        },
      },
    });
    const tool = createUpdateGoalTool(options);
    const originalGoal = getSessionEntry({ storePath, sessionKey: "global" })?.goal;

    const result = await tool.execute("call-already-complete", { status: "blocked" });

    expect(result.details).toMatchObject({
      status: "error",
      error: "goal is already complete",
      nextAction: expect.stringContaining("Do not retry update_goal"),
    });
    expect(getSessionEntry({ storePath, sessionKey: "global" })?.goal).toEqual(originalGoal);

    const repeated = await tool.execute("call-complete-again", { status: "complete" });
    expect(repeated.details).toMatchObject({
      status: "updated",
      goal: { id: "goal-1", objective: "ship", status: "complete" },
      nextAction: expect.stringContaining("provide the requested visible final response"),
    });
  });

  it("keeps missing-session failures on the generic error path", async () => {
    const { config } = await createStoreConfig();
    const tool = createUpdateGoalTool({
      agentSessionKey: "global",
      sessionAgentId: "research",
      config,
    });

    await expect(tool.execute("call-missing-session", { status: "blocked" })).rejects.toThrow(
      "session not found",
    );
  });
});
