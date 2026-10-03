import { describe, expect, it } from "vitest";
import { RunStreams, readRunEvent, type RunEvent } from "./stream-order";
import { projectRun } from "../thread/model";

const ev = (runId: string, seq: number, stream: string, data: Record<string, unknown>): RunEvent => ({
  runId,
  seq,
  stream,
  ts: seq,
  data,
});

describe("RunStreams", () => {
  it("keeps each run's events in seq order, whatever order they arrive in", () => {
    const streams = new RunStreams();
    for (const seq of [3, 1, 2, 5, 4]) {
      streams.accept(ev("a", seq, "assistant", { delta: String(seq) }));
    }
    for (const seq of [2, 1]) {
      streams.accept(ev("b", seq, "assistant", { delta: String(seq) }));
    }
    expect(streams.events("a").map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(streams.events("b").map((e) => e.seq)).toEqual([1, 2]);
    expect(streams.runIds()).toEqual(["a", "b"]);
  });

  it("ignores an already-seen seq and reports a forward gap", () => {
    const streams = new RunStreams();
    expect(streams.accept(ev("a", 1, "assistant", { delta: "x" }))).toBe("applied");
    expect(streams.accept(ev("a", 1, "assistant", { delta: "again" }))).toBe("stale");
    expect(streams.accept(ev("a", 2, "assistant", { delta: "y" }))).toBe("applied");
    expect(streams.accept(ev("a", 5, "assistant", { delta: "z" }))).toBe("gap");
    expect(streams.events("a").map((e) => e.data.delta)).toEqual(["x", "y", "z"]);
  });

  it("reads agent event payloads and rejects anything else", () => {
    expect(readRunEvent({ runId: "r", seq: 1, stream: "tool", ts: 5, data: { a: 1 } })).toEqual({
      runId: "r",
      seq: 1,
      stream: "tool",
      ts: 5,
      data: { a: 1 },
    });
    expect(readRunEvent({ runId: "r", stream: "tool" })).toBeNull();
    expect(readRunEvent(null)).toBeNull();
  });
});

describe("the thread shows a run in seq order", () => {
  it("builds text, step lines and the Done line in seq order even when events arrive shuffled", () => {
    const streams = new RunStreams();
    const events = [
      ev("r1", 1, "lifecycle", { phase: "start" }),
      ev("r1", 2, "tool", { phase: "start", name: "exec", toolCallId: "t1", args: { command: "node -v" } }),
      ev("r1", 3, "tool", { phase: "result", name: "exec", toolCallId: "t1", isError: false }),
      ev("r1", 4, "assistant", { delta: "Hello" }),
      ev("r1", 5, "assistant", { delta: " there" }),
      ev("r1", 6, "lifecycle", { phase: "end" }),
    ];
    for (const index of [4, 0, 5, 2, 1, 3]) {
      streams.accept(events[index]);
    }
    const blocks = projectRun(streams.events("r1"), new Map());
    expect(blocks.map((b) => b.kind)).toEqual(["step", "text", "done"]);
    expect(blocks[1]).toMatchObject({ kind: "text", text: "Hello there", streaming: false });
    expect(blocks[0]).toMatchObject({ kind: "step", tool: "exec", status: "ok" });
  });

  it("keeps two runs apart by runId", () => {
    const streams = new RunStreams();
    streams.accept(ev("r2", 2, "assistant", { delta: "two-b" }));
    streams.accept(ev("r1", 1, "assistant", { delta: "one-a" }));
    streams.accept(ev("r2", 1, "assistant", { delta: "two-a " }));
    const r1 = projectRun(streams.events("r1"), new Map());
    const r2 = projectRun(streams.events("r2"), new Map());
    expect(r1).toMatchObject([{ kind: "text", text: "one-a", streaming: true }]);
    expect(r2).toMatchObject([{ kind: "text", text: "two-a two-b", streaming: true }]);
  });
});
