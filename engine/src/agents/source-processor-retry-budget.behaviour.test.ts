// Written by Branch for AGENT-LOOP-0008 from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/agent/__tests__/processor-retry-budget.test.ts; resolver and native finalization coverage, not the complete generate/API-error test-file port.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHookRunner } from "../plugins/hooks.js";
import { createMockPluginRegistry } from "../plugins/hooks.test-fixtures.js";
import { runAgentHarnessBeforeAgentFinalizeHook } from "./harness/lifecycle-hook-helpers.js";
import {
  __resetProcessorRetryWarnings,
  DEFAULT_MAX_PROCESSOR_RETRIES,
  resolveMaxProcessorRetries,
} from "./source-processor-retry-budget.js";
import { TripWire } from "./source-trip-wire.js";

beforeEach(__resetProcessorRetryWarnings);
afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for("branch.pluginFinalizeRetryBudget"));
});

describe("source processor retry budget", () => {
  it.each([0, 1, 6, 20])("preserves the explicit processor retry budget %i", (maxProcessorRetries) => {
    const warn = vi.fn();
    expect(resolveMaxProcessorRetries({
      maxProcessorRetries, hasErrorProcessors: true, hasConfiguredErrorProcessors: true,
      agentId: "explicit", logger: { warn },
    })).toBe(maxProcessorRetries);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per agent for configured processors using the implicit cap", () => {
    const warn = vi.fn();
    const config = {
      maxProcessorRetries: undefined, hasErrorProcessors: true,
      hasConfiguredErrorProcessors: true, agentId: "configured", logger: { warn },
    };
    expect(resolveMaxProcessorRetries(config)).toBe(DEFAULT_MAX_PROCESSOR_RETRIES);
    resolveMaxProcessorRetries(config);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("maxProcessorRetries"), { agentId: "configured" });
    resolveMaxProcessorRetries({ ...config, agentId: "second" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn for framework defaults and does not cap a run without processors", () => {
    const warn = vi.fn();
    expect(resolveMaxProcessorRetries({
      maxProcessorRetries: undefined, hasErrorProcessors: true, logger: { warn },
    })).toBe(3);
    expect(resolveMaxProcessorRetries({
      maxProcessorRetries: undefined, hasErrorProcessors: false, logger: { warn },
    })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("caps changing retry feedback in the real native hook and harness path", async () => {
    let attempts = 0;
    const runner = createHookRunner(createMockPluginRegistry([{
      hookName: "before_agent_finalize", pluginId: "runaway",
      handler: () => {
        throw new TripWire(`Improve response ${++attempts}`, { retry: true }, "stable-processor");
      },
    }]));
    const run = (runId: string) => runAgentHarnessBeforeAgentFinalizeHook({
      ctx: { runId, agentId: "budget-agent" },
      event: { runId, sessionId: "session", stopHookActive: false },
      hookRunner: runner,
    });
    for (let index = 0; index < DEFAULT_MAX_PROCESSOR_RETRIES; index++) {
      expect(await run("harvest-runaway")).toEqual({ action: "revise", reason: `Improve response ${index + 1}` });
    }
    expect(await run("harvest-runaway")).toEqual({ action: "continue" });
    expect(await run("harvest-independent-run")).toEqual({ action: "revise", reason: "Improve response 5" });
  });
});
