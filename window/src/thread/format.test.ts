import { describe, expect, it } from "vitest";
import { clockLeft, dayStamp, formatDuration, modelName, parseDiffLines, rawDiffText, shortReason, stepExitCode, stepInputLines, stepKind, stepLabel, stepOutputFilename, stepOutputTail, stepsSummary } from "./format";
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
    expect(stepLabel({ ...step("computer"), title: "list_windows" })).toBe("Listed open windows");
    expect(stepLabel({ ...step("computer"), title: "frob_widget" })).toBe("Used the computer");
    expect(stepLabel({ ...step("computer"), title: "list_windows" })).not.toContain("list_windows");
    expect(stepLabel({ ...step("screen"), title: "desktop_show" })).toBe("Showed the desktop");
    expect(stepLabel({ ...step("screen"), title: "browser_show" })).toBe("Showed the browser");
    expect(stepLabel({ ...step("screen"), title: "split_right" })).toBe("Split the screen");
    expect(stepLabel({ ...step("screen"), title: "frob_pane" })).toBe("Used the screen");
    expect(stepLabel({ ...step("screen"), title: "desktop_show" })).not.toContain("desktop_show");
    expect(stepLabel({ ...step("screen"), title: "desktop_show" })).not.toBe("Used the computer");
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

describe("preview step kinds and cards", () => {
  it("maps tools onto the preview's read, edit, run, search and fetch kinds", () => {
    expect(stepKind("read")).toBe("read");
    expect(stepKind("skills_read")).toBe("read");
    expect(stepKind("apply_patch")).toBe("edit");
    expect(stepKind("write")).toBe("edit");
    expect(stepKind("exec")).toBe("run");
    expect(stepKind("bash")).toBe("run");
    expect(stepKind("command")).toBe("run");
    expect(stepKind("web_search")).toBe("search");
    expect(stepKind("search")).toBe("search");
    expect(stepKind("web_fetch")).toBe("fetch");
    expect(stepKind("fetch")).toBe("fetch");
    expect(stepKind("sessions_spawn")).toBeUndefined();
  });

  it("turns parsed input into key: value lines and never shows JSON braces", () => {
    expect(stepInputLines('{\n  "repo": "KeepOak/x",\n  "draft": true\n}')).toEqual(["repo: KeepOak/x", "draft: true"]);
    expect(stepInputLines('{"query":"date-fns: formatting in a time zone"}')).toEqual(["query: date-fns: formatting in a time zone"]);
    expect(stepInputLines("{")).toEqual([]);
    for (const line of stepInputLines('{"a":{"b":1},"list":[2,3]}')) {
      expect(line).not.toMatch(/[{}]/);
      expect(line).toMatch(/: /);
    }
  });

  it("keeps the last 4 output lines, a non-zero exit, and the save name", () => {
    expect(stepOutputTail(["a", "b", "c", "d", "e", "f"].join("\n"))).toBe("c\nd\ne\nf");
    expect(stepExitCode("Exit 1")).toBe(1);
    expect(stepExitCode("Exit 0")).toBeUndefined();
    expect(stepExitCode("Typecheck passed")).toBeUndefined();
    expect(stepOutputFilename("Ran the date test")).toBe("ran-the-date-test-output.txt");
  });

  it("parses a unified diff for the Diff and Raw file-card tabs", () => {
    const lines = parseDiffLines("@@ -1 +1 @@\n-old\n+new");
    expect(lines).toEqual([{ mark: "-", text: "old" }, { mark: "+", text: "new" }]);
    expect(rawDiffText(lines)).toBe("new");
  });
});
