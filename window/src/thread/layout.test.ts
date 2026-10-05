import { describe, expect, it } from "vitest";
import { layout, titleOf, turnOf } from "./layout";
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

  it("finds a block's turn", () => {
    expect(turnOf(blocks, 3).map((b) => b.key)).toEqual(["s1", "s2", "t1", "t2"]);
  });
});
