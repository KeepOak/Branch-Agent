import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import {
  MAX_CODE_MODE_CALL_TIMEOUT_SECONDS,
  readCodeModeCallTimeoutMs,
} from "./code-mode-call-timeout.js";
import { applyCodeModeCatalog } from "./code-mode.js";
import {
  createCodeModeHarness,
  pluginToolWithExecute,
  resetCodeModeTestState,
  resultDetails,
} from "./code-mode.test-support.js";
import { jsonResult, type AnyAgentTool } from "./tools/common.js";

const SUITE_MS = 19 * 60_000;

function harness(targets: AnyAgentTool[]) {
  const fixture = createCodeModeHarness({ codeMode: { timeoutMs: 1_000 } });
  applyCodeModeCatalog({ ...fixture.ctx, tools: [...fixture.tools, ...targets] });
  return { ...fixture, exec: fixture.tools[0]!, wait: fixture.tools[1]! };
}

function longSuite() {
  const started = createDeferred();
  const tool = pluginToolWithExecute("long_suite", "Long test suite", async () => {
    started.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, SUITE_MS);
    });
    return jsonResult({ status: "passed", exitCode: 0 });
  });
  return { tool, started };
}

afterEach(async () => {
  vi.useRealTimers();
  await resetCodeModeTestState();
});

describe("Code Mode per-call timeoutSeconds", () => {
  it("returns a 20-minute command's result when exec sets a 20-minute budget", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    const suite = longSuite();
    const fixture = harness([suite.tool]);
    const execution = fixture.exec.execute("long-suite", {
      timeoutSeconds: 1_200,
      code: "return await long_suite({});",
    });
    await suite.started.promise;
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(SUITE_MS);
    expect(resultDetails(await execution)).toMatchObject({
      status: "completed",
      value: { status: "passed", exitCode: 0 },
    });
  });

  it("lets wait set its own budget for a parked run", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    const suite = longSuite();
    const fixture = harness([suite.tool]);
    const execution = fixture.exec.execute("parked-suite", {
      code: "return await long_suite({});",
    });
    await suite.started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    const first = resultDetails(await execution);
    expect(first.status).toBe("waiting");
    const waited = fixture.wait.execute("resume-suite", {
      runId: first.runId,
      timeoutSeconds: 1_200,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(SUITE_MS);
    expect(resultDetails(await waited)).toMatchObject({
      status: "completed",
      value: { status: "passed", exitCode: 0 },
    });
  });

  it("puts the last 40 output lines of unfinished tools in the timeout error", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
    const started = createDeferred();
    const lines = Array.from({ length: 50 }, (_, index) => "suite line " + (index + 1));
    const tool = pluginToolWithExecute(
      "streaming_suite",
      "Streaming test suite",
      async (_id, _args, signal, onUpdate) => {
        onUpdate?.({
          content: [{ type: "text", text: lines.join("\n") }],
          details: { status: "running", tail: lines.join("\n") },
        });
        started.resolve();
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return jsonResult({});
      },
    );
    const fixture = harness([tool]);
    const execution = fixture.exec.execute("streaming-suite", {
      awaitResults: true,
      code: "const run = streaming_suite({}); await new Promise((resolve) => setTimeout(resolve, 60_000)); return await run;",
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(2_000);
    const result = resultDetails(await execution);
    expect(result).toMatchObject({ status: "failed", code: "timeout" });
    const error = String(result.error);
    expect(error).toContain("timeout exceeded");
    expect(error).toContain("timeoutSeconds");
    expect(error).toContain("[streaming_suite: last 40 lines]\nsuite line 11\n");
    expect(error).toContain("suite line 50");
    expect(error).not.toContain("suite line 10\n");
  });

  it("validates, clamps and advertises timeoutSeconds", () => {
    expect(readCodeModeCallTimeoutMs({})).toBeUndefined();
    expect(readCodeModeCallTimeoutMs({ timeoutSeconds: 1_200 })).toBe(1_200_000);
    expect(readCodeModeCallTimeoutMs({ timeoutSeconds: 99_999 })).toBe(
      MAX_CODE_MODE_CALL_TIMEOUT_SECONDS * 1_000,
    );
    for (const timeoutSeconds of [0, -5, "600", Number.NaN]) {
      expect(() => readCodeModeCallTimeoutMs({ timeoutSeconds })).toThrow(
        "timeoutSeconds must be a positive number of seconds.",
      );
    }
    const fixture = harness([]);
    expect(fixture.exec.description).toContain("Pass \u0060timeoutSeconds\u0060 (max 3600)");
    for (const tool of [fixture.exec, fixture.wait]) {
      const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
      expect(properties.timeoutSeconds).toMatchObject({ type: "number" });
    }
  });
});
