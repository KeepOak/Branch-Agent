import { afterEach, expect, it, vi } from "vitest";
import { emitAgentEvent, resetAgentEventsForTest } from "./agent-events.js";
import { projectAgentRunPace } from "./agent-run-pace.js";
import { getAgentRunContext, registerAgentRunContext } from "./agent-run-registry.js";

afterEach(() => {
  vi.useRealTimers();
  resetAgentEventsForTest();
});
function plan(runId: string, at: number, completed: number, total = 5) {
  vi.setSystemTime(at);
  emitAgentEvent({
    runId,
    stream: "plan",
    data: {
      steps: Array.from({ length: total }, (_, i) => ({
        step: `Step ${i}`,
        status: i < completed ? "completed" : "pending",
      })),
    },
  });
}
it("reports observed pace and an ETA range after three timed completed steps", () => {
  vi.useFakeTimers();
  registerAgentRunContext("one", { sessionKey: "agent:main:test" });
  plan("one", 1000, 0);
  plan("one", 11000, 1);
  plan("one", 31000, 2);
  plan("one", 61000, 3);
  expect(projectAgentRunPace("one", getAgentRunContext("one")?.pace, 61000)).toMatchObject({
    runId: "one",
    completed: 3,
    total: 5,
    observedSteps: 3,
    stepsPerMinute: 3,
    etaMinMs: 20000,
    etaMaxMs: 60000,
  });
});
it("does not borrow another run's samples or invent timings for an initial completed plan", () => {
  vi.useFakeTimers();
  registerAgentRunContext("one", {});
  registerAgentRunContext("two", {});
  plan("one", 1000, 0);
  plan("one", 11000, 3);
  plan("two", 12000, 3);
  expect(
    projectAgentRunPace("two", getAgentRunContext("two")?.pace, 12000).stepsPerMinute,
  ).toBeUndefined();
  expect(
    projectAgentRunPace("one", getAgentRunContext("one")?.pace, 12000).etaMaxMs,
  ).toBeUndefined();
});
it("ignores duplicate updates, resets changed plans, and withdraws overdue estimates", () => {
  vi.useFakeTimers();
  registerAgentRunContext("one", {});
  plan("one", 1000, 0);
  plan("one", 11000, 1);
  plan("one", 31000, 2);
  plan("one", 61000, 3);
  plan("one", 62000, 3);
  expect(projectAgentRunPace("one", getAgentRunContext("one")?.pace, 92000).reason).toBe("overdue");
  plan("one", 93000, 2);
  expect(projectAgentRunPace("one", getAgentRunContext("one")?.pace, 93000).observedSteps).toBe(0);
  plan("one", 94000, 2, 6);
  expect(
    projectAgentRunPace("one", getAgentRunContext("one")?.pace, 94000).etaMaxMs,
  ).toBeUndefined();
});
