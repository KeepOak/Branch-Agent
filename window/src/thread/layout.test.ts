import { describe, expect, it } from "vitest";
import { layout, turnOf } from "./layout";
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

  it("finds a block's turn", () => {
    expect(turnOf(blocks, 3).map((b) => b.key)).toEqual(["s1", "s2", "t1", "t2"]);
  });
});
