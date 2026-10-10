import { describe, expect, it } from "vitest";
import type { RunEvent } from "../connect/stream-order";
import { projectRun } from "./model";

let seq = 0;
const ev = (stream: string, data: Record<string, unknown>, ts = 0): RunEvent => ({ runId: "r1", seq: ++seq, stream, ts, data });
const SWITCHED = "Claude account 1 hit its limit until Sat 2:00 AM. Moved to Claude account 2.";
const WAITING = "Claude account 1 hit its limit until Sat 2:00 AM. No other subscription is free, so it waits until then.";

describe("projectRun account switch notice", () => {
  it("shows the account switch as a notice that stays after later assistant and tool events", () => {
    seq = 0;
    const events = [
      ev("lifecycle", { phase: "start" }),
      ev("tool", { phase: "start", toolCallId: "t1", name: "exec", args: { command: "ls" } }),
      ev("tool", { phase: "result", toolCallId: "t1", name: "exec", result: "ok" }),
      ev("run_status", { phase: "account_switched", message: SWITCHED }, 5_000),
      ev("assistant", { delta: "Done" }),
      ev("tool", { phase: "start", toolCallId: "t2", name: "exec", args: { command: "pwd" } }),
    ];
    const blocks = projectRun(events, new Map());
    const notices = blocks.filter((block) => block.kind === "notice");
    expect(notices).toEqual([expect.objectContaining({ kind: "notice", text: SWITCHED, at: 5_000 })]);
    expect(blocks.map((block) => block.kind)).toEqual(["step", "notice", "text", "step"]);
  });

  it("keeps the notice after the run ends", () => {
    seq = 0;
    const blocks = projectRun([
      ev("lifecycle", { phase: "start" }),
      ev("run_status", { phase: "account_switched", message: SWITCHED }),
      ev("assistant", { delta: "Done" }),
      ev("lifecycle", { phase: "end" }),
    ], new Map());
    expect(blocks.some((block) => block.kind === "notice" && block.text === SWITCHED)).toBe(true);
  });

  it("shows a long wait on the same account in plain words, not as a startup status", () => {
    seq = 0;
    const blocks = projectRun([
      ev("lifecycle", { phase: "start" }),
      ev("run_status", { phase: "account_limited", message: WAITING }),
    ], new Map());
    expect(blocks).toEqual([expect.objectContaining({ kind: "notice", text: WAITING })]);
  });

  it("starts the following text block after the notice instead of joining the earlier one", () => {
    seq = 0;
    const blocks = projectRun([
      ev("lifecycle", { phase: "start" }),
      ev("assistant", { delta: "Working" }),
      ev("run_status", { phase: "account_switched", message: SWITCHED }),
      ev("assistant", { delta: " on it" }),
    ], new Map());
    expect(blocks.map((block) => block.kind)).toEqual(["text", "notice", "text"]);
  });
});
