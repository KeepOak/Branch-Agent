import { afterEach, describe, expect, it } from "vitest";
import { setRunTraceSinkForTest, traceAgentRunEvent, traceRunStep } from "./run-trace.js";

const lines: string[] = [];
afterEach(() => {
  lines.length = 0;
  setRunTraceSinkForTest(undefined);
});

describe("run trace", () => {
  it("writes one line per step with the same run id, in order", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceRunStep("run-1", "accept", { agent: "builder-oak" });
    traceAgentRunEvent({
      runId: "run-1",
      stream: "lifecycle",
      data: { phase: "start" },
      agentId: "builder-oak",
    });
    traceAgentRunEvent({
      runId: "run-1",
      stream: "assistant",
      data: { text: "private words" },
      agentId: "builder-oak",
    });
    traceAgentRunEvent({
      runId: "run-1",
      stream: "assistant",
      data: { text: "more private words" },
      agentId: "builder-oak",
    });
    traceAgentRunEvent({
      runId: "run-1",
      stream: "lifecycle",
      data: { phase: "end" },
      agentId: "builder-oak",
    });
    expect(lines).toEqual([
      "trace id=run-1 step=accept agent=builder-oak",
      "trace id=run-1 step=run-start agent=builder-oak",
      "trace id=run-1 step=first-token agent=builder-oak",
      "trace id=run-1 step=final agent=builder-oak",
    ]);
  });

  it("records a failure with its short code and never the error text", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceAgentRunEvent({
      runId: "run-2",
      stream: "lifecycle",
      data: {
        phase: "error",
        code: "PROVIDER_TIMEOUT",
        error: "secret token sk-abcdefghijklmnopqrstuv in the text",
      },
      agentId: "researcher",
    });
    expect(lines).toEqual(["trace id=run-2 step=failed agent=researcher code=other"]);
    expect(lines.join("\n")).not.toMatch(/sk-|secret/);
  });

  it("writes a known gateway error code and nothing else", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceRunStep("run-5", "failed", { code: "UNAVAILABLE" });
    traceRunStep("run-6", "failed", { code: "sk-abcdefghijklmnopqrstuvwxyz" });
    traceRunStep("run-7", "failed", {
      code: "UNAVAILABLE_AND_A_LONG_SUFFIX_THAT_IS_NOT_A_KNOWN_CODE_1234567890",
    });
    traceRunStep("run-8", "failed", { code: "PROVIDER_TIMEOUT" });
    expect(lines).toEqual([
      "trace id=run-5 step=failed code=UNAVAILABLE",
      "trace id=run-6 step=failed code=other",
      "trace id=run-7 step=failed code=other",
      "trace id=run-8 step=failed code=other",
    ]);
    expect(lines.join("\n")).not.toMatch(/sk-/);
  });

  it("writes each run's first token once, even when several assistant events arrive", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    for (let i = 0; i < 5; i += 1) {
      traceAgentRunEvent({
        runId: "run-9",
        stream: "assistant",
        data: { text: `chunk ${i}` },
        agentId: "main",
      });
    }
    expect(lines).toEqual(["trace id=run-9 step=first-token agent=main"]);
  });

  it("does not repeat a first token after the run's cap is passed, for a run still in progress", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceAgentRunEvent({ runId: "run-live", stream: "assistant", data: {} });
    for (let i = 0; i < 600; i += 1) {
      traceAgentRunEvent({ runId: `run-other-${i}`, stream: "assistant", data: {} });
      traceAgentRunEvent({ runId: "run-live", stream: "assistant", data: {} });
    }
    expect(lines.filter((line) => line === "trace id=run-live step=first-token")).toHaveLength(1);
  });

  it("forgets a run when it ends, so its entry is released", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceAgentRunEvent({ runId: "run-10", stream: "assistant", data: {} });
    traceAgentRunEvent({ runId: "run-10", stream: "lifecycle", data: { phase: "end" } });
    traceAgentRunEvent({ runId: "run-10", stream: "assistant", data: {} });
    expect(lines).toEqual([
      "trace id=run-10 step=first-token",
      "trace id=run-10 step=final",
      "trace id=run-10 step=first-token",
    ]);
  });

  it("never writes a run id that is not a plain identifier", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceRunStep("has a space", "accept");
    traceRunStep("line\nbreak", "accept");
    traceRunStep("sk-abcdefghijklmnopqrstuvwxyz0123456789", "accept");
    traceRunStep("run-ok-1", "accept");
    traceRunStep("3f2c9a7e-1b4d-4e8a-9c2f-6d7e8f9a0b1c", "accept");
    expect(lines).toEqual([
      "trace id=invalid step=accept",
      "trace id=invalid step=accept",
      "trace id=invalid step=accept",
      "trace id=run-ok-1 step=accept",
      "trace id=3f2c9a7e-1b4d-4e8a-9c2f-6d7e8f9a0b1c step=accept",
    ]);
    expect(lines.join("\n")).not.toMatch(/sk-|has a space|line/);
  });

  it("drops fields that are not plain identifiers", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceRunStep("run-3", "failed", { agent: "has spaces and words", code: "x\ny" });
    expect(lines).toEqual(["trace id=run-3 step=failed code=other"]);
  });

  it("ignores events that are not part of the run lifecycle", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceAgentRunEvent({ runId: "run-4", stream: "tool", data: { name: "read" } });
    traceAgentRunEvent({ runId: "run-4", stream: "usage", data: { outputTokens: 3 } });
    expect(lines).toEqual([]);
  });
});
