import { describe, expect, it } from "vitest";
import { clockLeft, dayStamp, formatDuration, modelName, shortReason, stepsSummary } from "./format";
import type { Block } from "./model";

const step = (tool: string, status: "running" | "ok" = "ok"): Extract<Block, { kind: "step" }> => ({
  kind: "step",
  key: tool + status,
  tool,
  title: "",
  detail: "",
  status,
});

describe("thread words", () => {
  it("sums up a run's steps in plain words", () => {
    expect(stepsSummary([step("exec")])).toBe("Ran a command");
    expect(stepsSummary([step("exec"), step("exec"), step("read")])).toBe("Ran 2 commands and read a file · 3 steps");
    expect(stepsSummary([step("read"), step("read"), step("web_search")])).toBe("Read 2 files and searched the web · 3 steps");
    expect(stepsSummary([{ ...step("exec"), at: 1_000 }, { ...step("read"), at: 42_000 }])).toBe("Ran a command and read a file · 2 steps · 41s");
    expect(stepsSummary([step("exec"), step("read", "running")])).toBe("Reading a file");
    expect(stepsSummary([step("exec")], { title: "text", durationMs: 59_000 })).toBe("Ran a command");
  });

  it("stamps the day over the first message of each day", () => {
    const now = new Date(2026, 9, 4, 12, 20).getTime();
    const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const today = new Date(2026, 9, 4, 12, 2);
    const yesterday = new Date(2026, 9, 3, 16, 18);
    expect(dayStamp(today.getTime(), now)).toBe(`Today ${time(today)}`);
    expect(dayStamp(yesterday.getTime(), now)).toBe(`Yesterday ${time(yesterday)}`);
    expect(dayStamp(new Date(2026, 8, 30, 9, 5).getTime(), now)).toMatch(/^Sep 30 /);
  });

  it("formats durations, clocks and model names", () => {
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(clockLeft(125_000)).toBe("2:05");
    expect(modelName("ollama/qwen3:14b")).toBe("qwen3:14b");
    expect(modelName("openai/gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelName("openai/GPT-6.1-Sol")).toBe("GPT-6.1 Sol");
  });

  it("shortens an engine error to its first sentence without the lead-in", () => {
    const raw = "Your request couldn't be completed: ⚠️ Authentication failed (provider returned HTTP 401). Your provider token may have expired.";
    expect(shortReason(raw)).toBe("Authentication failed (provider returned HTTP 401).");
    expect(shortReason("Failed to observe plugin state entry. | PLUGIN_STATE_READ_FAILED | 42")).not.toContain("PLUGIN_STATE_READ_FAILED");
  });
});
