import "./sessions-spawn-tool.mocks.test-support.js";
// "Pick the model per task" decides whether a Trunk may name the model when it starts a task.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { supportedSpawnModelChoice } from "../subagents/spawn/subagent-spawn.test-helpers.js";

const { hoisted } = await import("./sessions-spawn-tool.mocks.test-support.js");

let createSessionsSpawnTool: typeof import("./sessions-spawn-tool.js").createSessionsSpawnTool;

const PER_TASK_OFF = '"Pick the model per task" is off in Settings › Models';

function spawnTool(config: BranchConfig, extra: Record<string, unknown> = {}) {
  return createSessionsSpawnTool({
    agentSessionKey: "agent:main:main",
    config: { agents: { entries: { main: {} } }, ...config },
    ...extra,
  });
}

describe("sessions_spawn per-task model choice", () => {
  beforeAll(async () => {
    ({ createSessionsSpawnTool } = await import("./sessions-spawn-tool.js"));
  });

  beforeEach(() => {
    hoisted.prepareModelChoiceMock.mockReset().mockImplementation(supportedSpawnModelChoice);
    hoisted.spawnSubagentDirectMock.mockReset().mockResolvedValue({
      status: "accepted",
      context: "isolated",
      childSessionKey: "agent:main:subagent:1",
      runId: "run-subagent",
    });
  });

  it("refuses a task that names a model while the setting is off and starts nothing", async () => {
    const tool = spawnTool({ tools: { modelChoice: { perTask: false } } });
    const result = await tool.execute("per-task-off", {
      task: "summarize the logs",
      model: "anthropic/claude-sonnet-4-6",
    });
    expect(result.details).toMatchObject({ status: "forbidden" });
    expect(String((result.details as { error?: unknown }).error)).toContain(PER_TASK_OFF);
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("does not offer the model parameter while the setting is off", () => {
    const off = spawnTool({ tools: { modelChoice: { perTask: false } } });
    const on = spawnTool({});
    const properties = (tool: typeof off) =>
      (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    expect(properties(off)).not.toHaveProperty("model");
    expect(properties(on)).toHaveProperty("model");
  });

  it("refuses a visible task that names a model while the setting is off before creating it", async () => {
    const callGateway = vi.fn();
    const tool = spawnTool(
      { tools: { modelChoice: { perTask: false } } },
      { callGateway, registerRun: vi.fn(), countActiveRuns: () => 0 },
    );
    const result = await tool.execute("per-task-off-visible", {
      task: "inspect issue",
      model: "anthropic/claude-sonnet-4-6",
      visible: true,
    });
    expect(result.details).toMatchObject({ status: "forbidden" });
    expect(callGateway).not.toHaveBeenCalled();
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalled();
  });

  it("still starts a task without a model while the setting is off", async () => {
    const tool = spawnTool({ tools: { modelChoice: { perTask: false } } });
    const result = await tool.execute("per-task-off-no-model", { task: "summarize the logs" });
    expect(result.details).toMatchObject({ status: "accepted" });
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
    expect(hoisted.spawnSubagentDirectMock.mock.calls[0]?.[0]).toMatchObject({ model: undefined });
  });

  it.each([
    ["on", { tools: { modelChoice: { perTask: true } } }],
    ["unset (default on)", {}],
  ] as const)(
    "starts the task on the chosen model while the setting is %s",
    async (_label, config) => {
      const tool = spawnTool(config as BranchConfig);
      const result = await tool.execute("per-task-on", {
        task: "summarize the logs",
        model: "anthropic/claude-sonnet-4-6",
      });
      expect(result.details).toMatchObject({ status: "accepted" });
      expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
      expect(hoisted.spawnSubagentDirectMock.mock.calls[0]?.[0]).toMatchObject({
        model: "anthropic/claude-sonnet-4-6",
      });
    },
  );
});
