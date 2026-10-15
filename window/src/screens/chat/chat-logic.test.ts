import { describe, expect, it } from "vitest";
import type { Block } from "../../thread/model";
import { DIVIDER_GAP_MS, dividerLabel, dividerPositions, readWorkMode, stepsLine, streamTokens, WORK_KEY, WORK_PER_KEY } from "./chat-logic";

type Step = Extract<Block, { kind: "step" }>;
const step = (key: string, over: Partial<Step> = {}): Step => ({ kind: "step", key, tool: "exec", title: "ls", detail: "", status: "ok", ...over });

describe("time dividers", () => {
  const t0 = new Date(2026, 9, 8, 16, 37).getTime();
  it("shows one before the first timed message, after a 15 minute gap and when the day changes", () => {
    const times = [t0, t0 + 60_000, undefined, t0 + DIVIDER_GAP_MS + 60_000, new Date(2026, 9, 9, 0, 5).getTime()];
    expect([...dividerPositions(times)]).toEqual([0, 3, 4]);
  });
  it("never puts one next to another centred line", () => {
    expect([...dividerPositions([t0, t0 + DIVIDER_GAP_MS], new Set([1]))]).toEqual([0]);
  });
  it("names today, yesterday and older days", () => {
    const now = new Date(2026, 9, 12, 12, 0).getTime();
    expect(dividerLabel(new Date(2026, 9, 12, 9, 5).getTime(), now)).toMatch(/^Today /);
    expect(dividerLabel(new Date(2026, 9, 11, 9, 5).getTime(), now)).toMatch(/^Yesterday /);
    expect(dividerLabel(t0, now)).toMatch(/Oct/);
    expect(dividerLabel(t0, now)).not.toMatch(/2026/);
    expect(dividerLabel(new Date(2025, 0, 2, 9, 5).getTime(), now)).toMatch(/2025/);
  });
});

describe("streaming tokens", () => {
  it("keeps every character and grows only at the end", () => {
    const text = "On it. It isn’t in Downloads\n\nHere’s my plan:";
    expect(streamTokens(text).join("")).toBe(text);
    const shorter = streamTokens("On it. It isn’t");
    expect(streamTokens(text).slice(0, shorter.length - 1)).toEqual(shorter.slice(0, -1));
  });
  it("handles an empty reply", () => expect(streamTokens("")).toEqual([]));
});

describe("steps line", () => {
  it("says what runs now and how many so far", () => {
    const line = stepsLine([step("a"), step("b", { status: "running", tool: "read", title: "notes.md" })]);
    expect(line.live).toBe(true);
    expect(line.text.endsWith("…")).toBe(true);
    expect(line.meta).toBe("2 so far");
  });
  it("counts failures and shows no clock once finished", () => {
    const line = stepsLine([step("a"), step("b", { status: "failed", detail: "Exit 1" })]);
    expect(line).toMatchObject({ live: false, failed: 1, meta: "2 steps" });
    expect(line.text).toMatch(/^Ran 2 commands/);
  });
});

describe("Show agents' work as", () => {
  it("defaults to Normal and lets one conversation differ", () => {
    expect(readWorkMode({}, "k").mode).toBe("normal");
    expect(readWorkMode({ [WORK_KEY]: "thinking" }, "k")).toEqual({ mode: "thinking", global: "thinking", override: null });
    expect(readWorkMode({ [WORK_KEY]: "thinking", [WORK_PER_KEY]: { k: "verbose" } }, "k")).toEqual({ mode: "verbose", global: "thinking", override: "verbose" });
    expect(readWorkMode({ [WORK_KEY]: "loud", [WORK_PER_KEY]: { k: 3 } }, "k").mode).toBe("normal");
  });
});
