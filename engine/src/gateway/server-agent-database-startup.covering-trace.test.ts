import { expect, it } from "vitest";
import {
  formatCoveringWaitOutcome,
  formatCoveringWaitStart,
} from "./server-agent-database-startup.js";

it("names the awaiting agent and the pending publication barrier when a covering wait starts", () => {
  expect(formatCoveringWaitStart("builder-oak", "scope=builder-oak,tk degraded=false")).toBe(
    "agent builder-oak awaits covering model publication; pending scope=builder-oak,tk degraded=false",
  );
});

it("reports no pending barrier as none at wait start", () => {
  expect(formatCoveringWaitStart("tk", undefined)).toBe(
    "agent tk awaits covering model publication; pending none",
  );
});

it("reports how a covering wait settled and how many publications it waited on", () => {
  expect(formatCoveringWaitOutcome({ agentId: "tk", outcome: "published", waits: 1 })).toBe(
    "agent tk covering model publication published after 1 wait(s)",
  );
  expect(formatCoveringWaitOutcome({ agentId: "builder-elm", outcome: "left-out", waits: 2 })).toBe(
    "agent builder-elm covering model publication left-out after 2 wait(s)",
  );
});
