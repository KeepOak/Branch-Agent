import { describe, expect, it } from "vitest";
import { computerCardState, runWasStopped } from "./computer-card";
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
});
