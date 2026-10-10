import { describe, expect, it } from "vitest";
import { isInternalStep } from "./internal-steps";
import { layout } from "./layout";
import type { Block } from "./model";

const step = (key: string, tool: string): Block => ({ kind: "step", key, outputKey: `run-1:${key}`, tool, title: tool, detail: "", status: "ok" });
const user: Block = { kind: "user", key: "u1", text: "Check the inbox" };
const reply: Block = { kind: "text", key: "t1", text: "Nothing needs you.", streaming: false };

describe("heartbeat steps stay out of the transcript", () => {
  it("recognises the engine's check-in tools, including namespaced names", () => {
    expect(isInternalStep(step("h", "heartbeat_respond"))).toBe(true);
    expect(isInternalStep(step("h", "mcp__branch__heartbeat_respond"))).toBe(true);
    expect(isInternalStep(step("r", "read"))).toBe(false);
    expect(isInternalStep(step("r", "heartbeats_report"))).toBe(false);
    expect(isInternalStep(step("h", "heartbeat_run_check"))).toBe(false);
  });

  it("folds only the visible steps, so a check-in between two steps adds no count", () => {
    const blocks: Block[] = [user, step("s1", "read"), step("h1", "heartbeat_respond"), step("s2", "exec"), reply];
    const items = layout(blocks);
    expect(items.map((item) => (item.type === "steps" ? `steps:${item.steps.length}` : item.block.key))).toEqual(["u1", "steps:2", "t1"]);
  });

  it("keeps each reply's block index into the full list, so actions still hit the right block", () => {
    const blocks: Block[] = [user, step("h1", "heartbeat_respond"), step("s1", "read"), reply];
    const reply_ = layout(blocks).find((item) => item.type === "block" && item.block.key === "t1");
    expect(reply_).toMatchObject({ index: 3, firstReply: true, face: false });
  });

  it("keeps heartbeat_run_check visible in the transcript", () => {
    const items = layout([user, step("c1", "heartbeat_run_check"), reply]);
    expect(items.map((item) => (item.type === "steps" ? `steps:${item.steps.length}` : item.block.key))).toEqual(["u1", "steps:1", "t1"]);
  });

  it("gives a check-in-only turn no fold and leaves its reply with the gutter face", () => {
    const blocks: Block[] = [user, step("h1", "heartbeat_respond"), step("h2", "heartbeat_respond"), reply];
    const items = layout(blocks);
    expect(items.some((item) => item.type === "steps")).toBe(false);
    expect(items.map((item) => (item.type === "block" ? item.block.key : "steps"))).toEqual(["u1", "t1"]);
    expect(items[1]).toMatchObject({ face: true });
  });
});
