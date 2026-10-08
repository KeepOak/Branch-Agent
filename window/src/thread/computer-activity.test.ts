import { describe, expect, it } from "vitest";
import { computerActivityTurns, isComputerStep, stepRunId } from "./computer-activity";
import type { Block } from "./model";

const user = (key: string, text: string): Block => ({ kind: "user", key, text });
const text = (key: string, words: string): Block => ({ kind: "text", key, text: words, streaming: false });
const step = (key: string, tool: string, title: string, runId: string): Block => ({
  kind: "step",
  key,
  outputKey: `${runId}:${key}`,
  tool,
  title,
  detail: "",
  status: "ok",
});

describe("computerActivityTurns", () => {
  it("keeps browser and computer actions from two turns on separate cards", () => {
    const blocks: Block[] = [
      user("u1", "Open the garden site"),
      step("b1", "browser", "Opened the garden site", "run-browser"),
      step("b2", "browser", "Read the about page", "run-browser"),
      text("t1", "The garden site is open."),
      user("u2", "Use this computer"),
      step("c1", "computer", "Clicked Sign in", "run-computer"),
      step("c2", "computer", "Typed the email", "run-computer"),
      step("c3", "computer", "Opened the inbox", "run-computer"),
      text("t2", "Signed in."),
    ];
    const turns = computerActivityTurns(blocks);
    expect(turns).toHaveLength(2);
    expect(turns[0].map((s) => s.key)).toEqual(["b1", "b2"]);
    expect(turns[1].map((s) => s.key)).toEqual(["c1", "c2", "c3"]);
    expect(turns.flat().length).toBe(5);
    expect(turns.some((group) => group.length === 5)).toBe(false);
  });

  it("starts a new card when the run changes without a new user message", () => {
    const blocks: Block[] = [
      step("b1", "browser", "Opened the garden site", "run-a"),
      step("c1", "computer", "Clicked Sign in", "run-b"),
    ];
    expect(computerActivityTurns(blocks).map((group) => group.map((s) => s.key))).toEqual([["b1"], ["c1"]]);
  });

  it("ignores ordinary command steps when grouping computer activity", () => {
    const command = step("x", "exec", "ls", "run");
    const browser = step("b1", "browser", "Opened", "run-browser");
    expect(isComputerStep(command)).toBe(false);
    expect(isComputerStep(browser)).toBe(true);
    if (isComputerStep(browser)) expect(stepRunId(browser)).toBe("run-browser");
    expect(computerActivityTurns([user("u", "list"), command])).toEqual([]);
  });
});
