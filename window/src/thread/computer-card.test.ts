import { describe, expect, it } from "vitest";
import { computerCardState, runWasStopped, turnDoneLines } from "./computer-card";
import type { Block } from "./model";

describe("computerCardState", () => {
  it("is working while a computer step runs", () => {
    expect(computerCardState({ running: true, status: "running", controlling: false, stopped: false })).toBe("working");
  });
  it("is yours while you have control, even if a step is still running", () => {
    expect(computerCardState({ running: true, status: "running", controlling: true, stopped: false })).toBe("yours");
  });
  it("is stopped when the run was stopped", () => {
    expect(computerCardState({ running: false, status: "ok", controlling: false, stopped: true })).toBe("stopped");
  });
  it("is stopped when the latest step failed or was denied", () => {
    expect(computerCardState({ running: false, status: "failed", controlling: false, stopped: false })).toBe("stopped");
    expect(computerCardState({ running: false, status: "denied", controlling: false, stopped: false })).toBe("stopped");
  });
  it("is done when the computer work finished", () => {
    expect(computerCardState({ running: false, status: "ok", controlling: false, stopped: false })).toBe("done");
  });
  it("is done when you still hold control but the run has finished", () => {
    expect(computerCardState({ running: false, status: "ok", controlling: true, stopped: false })).toBe("done");
  });
  it("is done when a later turn is running and you take over that later turn", () => {
    expect(computerCardState({ running: true, status: "ok", controlling: true, stopped: false })).toBe("done");
  });
  it("is stopped when you still hold control but the run was stopped", () => {
    expect(computerCardState({ running: false, status: "ok", controlling: true, stopped: true })).toBe("stopped");
    expect(computerCardState({ running: false, status: "failed", controlling: true, stopped: false })).toBe("stopped");
  });
});

describe("runWasStopped", () => {
  it("reads the thread's stopped Done line", () => {
    const blocks: Block[] = [
      { kind: "step", key: "s", tool: "computer", title: "Opened mail", detail: "", status: "ok" },
      { kind: "done", key: "d", runId: "r", stopped: true },
    ];
    expect(runWasStopped(blocks)).toBe(true);
    expect(runWasStopped(blocks.slice(0, 1))).toBe(false);
  });
  it("does not treat an earlier turn's stop as this turn's stop", () => {
    const oldStep: Block = { kind: "step", key: "old", outputKey: "run-old:old", tool: "computer", title: "Opened mail", detail: "", status: "ok" };
    const stopped: Block = { kind: "done", key: "d1", runId: "run-old", stopped: true };
    const now: Block = { kind: "step", key: "now", outputKey: "run-now:now", tool: "computer", title: "Searching", detail: "", status: "running" };
    expect(runWasStopped([oldStep, stopped])).toBe(true);
    expect(runWasStopped([now, stopped])).toBe(false);
    expect(runWasStopped([now])).toBe(false);
  });
});

describe("turnDoneLines", () => {
  it("keeps only the Done line for these steps' run", () => {
    const old: Block = { kind: "step", key: "old", outputKey: "run-old:old", tool: "computer", title: "Opened mail", detail: "", status: "ok" };
    const now: Block = { kind: "step", key: "now", outputKey: "run-now:now", tool: "computer", title: "Searching", detail: "", status: "running" };
    const stopped: Block = { kind: "done", key: "d1", runId: "run-old", stopped: true };
    const finished: Block = { kind: "done", key: "d2", runId: "run-now" };
    expect(turnDoneLines([now], [old, stopped, now, finished])).toEqual([finished]);
    expect(turnDoneLines([old], [old, stopped, now, finished])).toEqual([stopped]);
  });
});
