import { describe, expect, it } from "vitest";
import type { Block } from "../../thread/model";
import { activityState, summaryLine, timelineItems, timelineSummary } from "./pane-model";
import { appendTerminal, MAX_TERMINAL_TEXT } from "./terminal-text";

const blocks: Block[] = [
  { kind: "user", key: "u", text: "Find the invoice", meta: { timestamp: 1_000 } },
  { kind: "step", key: "s", tool: "exec", title: "Searched Downloads", detail: "0 files match", status: "ok", output: "nothing" },
  { kind: "text", key: "t", text: "It isn't there.", streaming: false, meta: { timestamp: 117_000, model: "m1", provider: "p", usage: { input: 2140, output: 310, cost: 0.05 } } },
];

describe("side pane model", () => {
  it("preserves recorded step timestamps in sequence order", () => {
    const items = timelineItems([
      { kind: "step", key: "one", tool: "read", title: "first", detail: "", status: "ok", at: 22000 },
      { kind: "step", key: "two", tool: "read", title: "second", detail: "", status: "ok", at: 15000 },
    ], "Ada");
    expect(items.map((item) => [item.key, item.at])).toEqual([["one", 22000], ["two", 15000]]);
  });
  it("lists steps, replies and messages in order with what the engine recorded", () => {
    const items = timelineItems(blocks, "Ada");
    expect(items.map((i) => i.kind)).toEqual(["you", "tool", "model"]);
    expect(items[1]).toMatchObject({ title: "Searched Downloads", line: "Ada · 0 files match", tech: "exec", happened: "nothing" });
    expect(items[2]).toMatchObject({ line: "Ada · m1", tech: "p/m1", cost: 0.05, tokensIn: 2140 });
  });
  it("sums steps, time and cost, and leaves out what wasn't recorded", () => {
    const items = timelineItems(blocks, "Ada");
    expect(summaryLine(timelineSummary(items, false), false)).toBe("3 steps · 1m 56s · $0.05");
    expect(summaryLine(timelineSummary(items.slice(1, 2), false), false)).toBe("1 step");
    expect(summaryLine(timelineSummary(items, true, 121_000), true)).toBe("3 steps · 2m 0s so far · $0.05");
  });
  it("says waiting before working", () => {
    expect(activityState(true, 1).text).toBe("Waiting on you");
    expect(activityState(true, 0).text).toBe("Working");
    expect(activityState(false, 0).text).toBe("Not working");
  });
});

describe("terminal text", () => {
  it("drops escape sequences and applies carriage returns and backspaces", () => {
    expect(appendTerminal("", "\x1b[32mok\x1b[0m\r\nnext")).toBe("ok\nnext");
    expect(appendTerminal("abc", "\rxy")).toBe("xy");
    expect(appendTerminal("ab", "\b")).toBe("a");
    expect(appendTerminal("", "\x1b]0;title\x07$ ")).toBe("$ ");
  });
  it("keeps only the newest text past the cap", () => {
    expect(appendTerminal("", "x".repeat(MAX_TERMINAL_TEXT + 10)).length).toBe(MAX_TERMINAL_TEXT);
  });
});
