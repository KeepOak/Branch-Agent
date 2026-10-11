import { describe, expect, it } from "vitest";
import { isComputerStep, layout, stepRunId, titleOf, turnOf } from "./layout";
import type { Block } from "./model";

const blocks: Block[] = [
  { kind: "user", key: "u1", text: "a" },
  { kind: "step", key: "s1", tool: "exec", title: "", detail: "", status: "ok" },
  { kind: "step", key: "s2", tool: "read", title: "", detail: "", status: "ok" },
  { kind: "text", key: "t1", text: "x", streaming: false },
  { kind: "text", key: "t2", text: "y", streaming: false },
  { kind: "user", key: "u2", text: "b" },
  { kind: "text", key: "t3", text: "z", streaming: false },
];

describe("layout", () => {
  it("folds consecutive steps together and marks each turn's first reply for the gutter face", () => {
    const items = layout(blocks);
    const names = items.map((i) => (i.type === "steps" ? `steps:${i.steps.length}` : `${i.block.key}${i.firstReply ? "*" : ""}`));
    expect(names).toEqual(["u1", "steps:2", "t1*", "t2", "u2", "t3*"]);
  });

  it("puts the face on each turn's first item: the Steps fold when the turn starts with steps", () => {
    const faces = layout(blocks).map((i) => (i.type === "steps" ? `steps:${i.face}` : `${i.block.key}:${i.type === "block" && i.face}`));
    expect(faces).toEqual(["u1:false", "steps:true", "t1:false", "t2:false", "u2:false", "t3:true"]);
  });

  it("names a finished turn's steps by its reply's first line and run length", () => {
    const turn: Block[] = [
      { kind: "user", key: "u", text: "tidy" },
      { kind: "step", key: "s", tool: "exec", title: "", detail: "", status: "ok" },
      { kind: "text", key: "t", text: "**Sorted** 214 files.\n\n- more", streaming: false },
      { kind: "done", key: "d", runId: "r", durationMs: 72000 },
    ];
    const steps = layout(turn)[1];
    expect(steps.type === "steps" && steps.run).toEqual({ title: "Sorted 214 files", durationMs: 72000 });
    expect(layout(turn.slice(0, 3))[1]).toMatchObject({ run: undefined });
    expect(titleOf("## A [link](x) here:")).toBe("A link here");
  });

  it("keeps one Steps fold for a run whose tool-call rounds have Thinking rows between them", () => {
    const turn: Block[] = [
      { kind: "user", key: "u", text: "fix it" },
      { kind: "thinking", key: "th1", text: "plan", live: false },
      { kind: "step", key: "s1", outputKey: "r:s1", tool: "exec", title: "", detail: "", status: "ok" },
      { kind: "step", key: "s2", outputKey: "r:s2", tool: "exec", title: "", detail: "", status: "ok" },
      { kind: "thinking", key: "th2", text: "more", live: false },
      { kind: "step", key: "s3", outputKey: "r:s3", tool: "exec", title: "", detail: "", status: "ok" },
      { kind: "step", key: "s4", outputKey: "r:s4", tool: "exec", title: "", detail: "", status: "ok" },
      { kind: "text", key: "t", text: "I've fixed all three.", streaming: false },
      { kind: "done", key: "d", runId: "r", durationMs: 1729000 },
    ];
    const items = layout(turn);
    const shape = items.map((i) => (i.type === "steps" ? `steps:${i.steps.map((s) => s.key).join(",")}` : i.block.key));
    expect(shape).toEqual(["u", "th1", "steps:s1,s2,s3,s4", "th2", "t", "d"]);
    expect(items.filter((i) => i.type === "steps")).toHaveLength(1);
  });

  it("finds a block's turn", () => {
    expect(turnOf(blocks, 3).map((b) => b.key)).toEqual(["s1", "s2", "t1", "t2"]);
    expect(turnOf(blocks, 0).map((b) => b.key)).toEqual(["u1", "s1", "s2", "t1", "t2"]);
  });

  it("does not fold steps from a later turn or a later run into the earlier card", () => {
    const twoTurns: Block[] = [
      { kind: "user", key: "u1", text: "browse" },
      { kind: "step", key: "b1", outputKey: "run-a:b1", tool: "browser", title: "Opened", detail: "", status: "ok" },
      { kind: "user", key: "u2", text: "computer" },
      { kind: "step", key: "c1", outputKey: "run-b:c1", tool: "computer", title: "Clicked", detail: "", status: "ok" },
    ];
    expect(layout(twoTurns).filter((i) => i.type === "steps")).toHaveLength(2);

    const twoRuns: Block[] = [
      { kind: "step", key: "b1", outputKey: "run-a:b1", tool: "browser", title: "Opened", detail: "", status: "ok" },
      { kind: "step", key: "c1", outputKey: "run-b:c1", tool: "computer", title: "Clicked", detail: "", status: "ok" },
    ];
    expect(layout(twoRuns).map((i) => (i.type === "steps" ? i.steps.map((s) => s.key) : i.block.key))).toEqual([["b1"], ["c1"]]);
  });

  it("reads a step's run from outputKey and only treats computer-like tools as activity", () => {
    const browser: Block = { kind: "step", key: "b1", outputKey: "run-a:b1", tool: "browser", title: "Opened", detail: "", status: "ok" };
    const command: Block = { kind: "step", key: "x", outputKey: "run-a:x", tool: "exec", title: "ls", detail: "", status: "ok" };
    expect(isComputerStep(browser)).toBe(true);
    expect(isComputerStep(command)).toBe(false);
    expect(stepRunId(browser)).toBe("run-a");
  });
});
