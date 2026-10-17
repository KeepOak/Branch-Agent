/**
 * Exec timeout alias tests.
 * The schema advertises only timeoutSeconds, but models keep sending timeout (the process tool
 * and other shells use that name). Exec accepts it as the same number of seconds instead of
 * failing the call, which made agents retry the same rejected arguments.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessSupervisor } from "../process/supervisor/index.js";
import type { SpawnInput } from "../process/supervisor/types.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.test-support.js";
import { createExecTool } from "./bash-tools.exec-run.js";
import { execSchema, nodeExecSchema } from "./bash-tools.schemas.js";
import { createLazyExecTool } from "./lazy-exec-tool.js";

const supervisorMock = vi.hoisted(() => ({
  spawn: vi.fn<ProcessSupervisor["spawn"]>(),
  cancel: vi.fn<ProcessSupervisor["cancel"]>(),
  cancelScope: vi.fn<ProcessSupervisor["cancelScope"]>(),
}));

vi.mock("../process/supervisor/index.js", () => ({
  getProcessSupervisor: () => supervisorMock,
}));

function mockSpawn() {
  supervisorMock.spawn.mockImplementationOnce(async (input: SpawnInput) => ({
    activity: { resultSettled: true, lastOutputAtMs: Date.now() },
    runId: input.runId ?? "call",
    pid: 1234,
    startedAtMs: Date.now(),
    wait: vi.fn(async () => ({
      reason: "exit" as const,
      exitCode: 0,
      exitSignal: null,
      durationMs: 1,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      noOutputTimedOut: false,
    })),
    cancel: vi.fn(),
  }));
}

function gatewayExec() {
  return createExecTool({
    host: "gateway",
    security: "full",
    ask: "off",
    allowBackground: false,
    timeoutSec: 120,
  });
}

describe("exec timeout alias", () => {
  beforeEach(() => {
    supervisorMock.spawn.mockReset();
    supervisorMock.cancel.mockReset();
    supervisorMock.cancelScope.mockReset();
    resetProcessRegistryForTests();
  });

  it("keeps timeout out of the model-facing schemas", () => {
    expect(execSchema.properties).toHaveProperty("timeoutSeconds");
    expect(execSchema.properties).not.toHaveProperty("timeout");
    expect(nodeExecSchema.properties).not.toHaveProperty("timeout");
  });

  it.each([
    { name: "timeoutSeconds", args: { timeoutSeconds: 7 } },
    { name: "timeout", args: { timeout: 7 } },
    { name: "numeric string timeout", args: { timeout: "7" } },
  ])("runs the command with the $name lifetime", async ({ args }) => {
    mockSpawn();

    const result = await gatewayExec().execute("timeout-alias", {
      command: "echo ok",
      ...args,
    } as never);

    expect(result.details.status).toBe("completed");
    expect(supervisorMock.spawn).toHaveBeenCalledOnce();
    expect(supervisorMock.spawn.mock.calls[0]?.[0]?.timeoutMs).toBe(7_000);
  });

  it("prefers timeoutSeconds when both keys are sent", async () => {
    mockSpawn();

    await gatewayExec().execute("timeout-both", {
      command: "echo ok",
      timeoutSeconds: 3,
      timeout: 600,
    } as never);

    expect(supervisorMock.spawn.mock.calls[0]?.[0]?.timeoutMs).toBe(3_000);
  });

  it("uses timeout for the node wait budget", () => {
    for (const createTool of [createExecTool, createLazyExecTool]) {
      const tool = createTool({ host: "node", timeoutSec: 120 });
      expect(tool.getExecutionTimeoutMs?.({ command: "echo ready", timeout: 1 })).toBe(
        tool.getExecutionTimeoutMs?.({ command: "echo ready", timeoutSeconds: 1 }),
      );
      expect(
        tool.getExecutionTimeoutMs?.({ command: "echo ready", timeoutSeconds: 1, timeout: 600 }),
      ).toBe(15_000);
    }
  });

  it("rejects a timeout that names no seconds before running anything", async () => {
    await expect(
      gatewayExec().execute("bad-timeout", { command: "exit 99", timeout: "soon" } as never),
    ).rejects.toThrow('exec parameter "timeout" must be a number of seconds; use "timeoutSeconds"');
    expect(supervisorMock.spawn).not.toHaveBeenCalled();
  });
});
