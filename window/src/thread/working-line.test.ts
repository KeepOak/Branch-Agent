// The R1 working line's words: the app a tool works in, in plain words. Never a tool id, path or command.
import { describe, expect, it } from "vitest";
import type { Block } from "./model";
import { workingLine, workingWords } from "./format";

type Step = Extract<Block, { kind: "step" }>;
const step = (tool: string, status: Step["status"] = "ok", key = tool): Step => ({ kind: "step", key, tool, title: "", detail: "", status });

describe("workingWords: the app a tool works in", () => {
  it.each([
    ["mcp__plugin_github_github__create_pull_request", "Working in GitHub"],
    ["github.create-issue", "Working in GitHub"],
    ["mcp__google_gmail__send_message", "Working in Gmail"],
    ["mcp__google_calendar__list_events", "Working in Calendar"],
    ["browser", "Working in the browser"],
    ["web_search", "Working in the browser"],
    ["web_fetch", "Working in the browser"],
    ["read", "Working in your files"],
    ["apply_patch", "Working in your files"],
    ["exec", "Working on your computer"],
    ["bash", "Working on your computer"],
    ["code_execution", "Working on your computer"],
    ["computer", "Working on your computer"],
    ["memory_search", "Checking its memory"],
    ["sessions_history", "Checking its memory"],
    ["skills_read", "Using a skill"],
    ["sessions_spawn", "Waiting for its helpers"],
    ["agents_wait", "Waiting for its helpers"],
  ])("%s says %s", (tool, words) => {
    expect(workingWords(tool)).toBe(words);
  });

  it("names no app for a connected server it does not know, so the caller falls back to Working", () => {
    expect(workingWords("mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch")).toBeUndefined();
    expect(workingWords("mcp__acme__do_thing")).toBeUndefined();
  });
});

describe("workingLine: the step at work, else the last step, else Working", () => {
  it("uses the running step over the finished ones before it", () => {
    expect(workingLine([step("read"), step("github.create-issue", "running")])).toBe("Working in GitHub");
  });

  it("uses the last finished step between steps", () => {
    expect(workingLine([step("browser"), step("exec")])).toBe("Working on your computer");
  });

  it("falls back to Working with no steps or an unknown tool", () => {
    expect(workingLine([])).toBe("Working");
    expect(workingLine([{ kind: "text", key: "a", text: "On it.", streaming: false }])).toBe("Working");
    expect(workingLine([step("mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch", "running")])).toBe("Working");
  });

  it("never returns a tool id, a path or a command", () => {
    const line = workingLine([step("mcp__plugin_github_github__create_pull_request", "running")]);
    expect(line).not.toMatch(/mcp__|_|\/|create|exec/);
  });
});
