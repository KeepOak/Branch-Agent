// Written by Branch for AGENT-LOOP-0007 from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/agent/agent-processor.test.ts; native hook integration coverage, not a complete upstream test-file port.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHookRunner } from "../plugins/hooks.js";
import { createMockPluginRegistry } from "../plugins/hooks.test-fixtures.js";
import { runAgentHarnessBeforeAgentFinalizeHook } from "./harness/lifecycle-hook-helpers.js";
import { TripWire } from "./source-trip-wire.js";

function finalize(handler: () => unknown, next?: () => unknown) {
  const hooks = [{ hookName: "before_agent_finalize", pluginId: "processor", handler }];
  if (next) hooks.push({ hookName: "before_agent_finalize", pluginId: "next", handler: next });
  return runAgentHarnessBeforeAgentFinalizeHook({
    ctx: { runId: "harvest-tripwire", agentId: "agent" },
    event: {
      runId: "harvest-tripwire",
      sessionId: "session",
      stopHookActive: false,
      lastAssistantMessage: "Rejected first answer",
    },
    hookRunner: createHookRunner(createMockPluginRegistry(hooks)),
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("branch.pluginFinalizeRetryBudget"));
});

describe("TripWire through native hook dispatch and harness finalization", () => {
  it("should not execute subsequent processors after abort", async () => {
    const error = new TripWire("Content validation failed", { metadata: { rule: "citation" } }, "guard");
    const next = vi.fn();
    const result = await finalize(() => { throw error; }, next);
    expect(result).toEqual({ action: "abort", error });
    expect(next).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(Error);
    expect(error.options.metadata).toEqual({ rule: "citation" });
    expect(error.processorId).toBe("guard");
  });

  it("should retry with feedback when processor calls abort with retry: true", async () => {
    const result = await finalize(() => {
      throw new TripWire("Response quality too low, please improve", { retry: true }, "quality");
    });
    expect(result.action).toBe("revise");
    if (result.action !== "revise") throw new Error("Expected a processor retry");
    expect(result.reason).toContain("Response quality too low, please improve");
  });

  it("propagates an abort without a retry flag as the original typed error", async () => {
    const error = new TripWire("Stop");
    expect(await finalize(() => { throw error; })).toEqual({ action: "abort", error });
    expect(error.options).toEqual({});
  });

  it("keeps ordinary plugin failures on the native best-effort path", async () => {
    expect(await finalize(() => { throw new Error("ordinary plugin failure"); }))
      .toEqual({ action: "continue" });
  });
});
