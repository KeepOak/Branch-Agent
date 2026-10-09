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
    expect(lines).toEqual(["trace id=run-2 step=failed agent=researcher code=PROVIDER_TIMEOUT"]);
    expect(lines.join("\n")).not.toMatch(/sk-|secret/);
  });

  it("drops fields that are not plain identifiers", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceRunStep("run-3", "failed", { agent: "has spaces and words", code: "x\ny" });
    expect(lines).toEqual(["trace id=run-3 step=failed"]);
  });

  it("ignores events that are not part of the run lifecycle", () => {
    setRunTraceSinkForTest((line) => lines.push(line));
    traceAgentRunEvent({ runId: "run-4", stream: "tool", data: { name: "read" } });
    traceAgentRunEvent({ runId: "run-4", stream: "usage", data: { outputTokens: 3 } });
    expect(lines).toEqual([]);
  });
});
