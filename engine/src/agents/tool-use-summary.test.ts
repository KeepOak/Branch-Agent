// Ported from QwenLM/qwen-code packages/core/src/services/toolUseSummary.test.ts at 728c13de219885de6a3e93223460c3ec8a8f690d.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SideQuery, SideQueryRequest } from "./agent-loop-side-query.js";
import {
  cleanSummary,
  createToolUseSummaryMessage,
  generateToolUseSummary,
  type GenerateToolUseSummaryParams,
  TOOL_USE_SUMMARY_SYSTEM_PROMPT,
  truncateJson,
} from "./tool-use-summary.js";

describe("truncateJson", () => {
  it("returns JSON for short values", () => {
    expect(truncateJson({ foo: "bar" }, 100)).toBe('{"foo":"bar"}');
    expect(truncateJson("hello", 100)).toBe('"hello"');
    expect(truncateJson(42, 100)).toBe("42");
  });

  it("truncates long values with ellipsis", () => {
    const long = "x".repeat(500);
    const result = truncateJson(long, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles undefined", () => {
    expect(truncateJson(undefined, 100)).toBe("[undefined]");
  });

  it("pre-truncates large string leaves before JSON serialization", () => {
    const huge = "x".repeat(10_000_000);
    const result = truncateJson(huge, 300);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith("...")).toBe(true);
  });

  it("pre-truncates large string fields inside objects", () => {
    const obj = { content: "y".repeat(10_000_000) };
    const result = truncateJson(obj, 300);
    expect(result.length).toBeLessThanOrEqual(300);
    const yCount = (result.match(/y/g) ?? []).length;
    expect(yCount).toBeLessThan(300);
  });

  it("handles circular references gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(truncateJson(circular, 100)).toBe("[unable to serialize]");
  });
});

describe("cleanSummary", () => {
  it("preserves well-formed labels", () => {
    expect(cleanSummary("Searched in auth/")).toBe("Searched in auth/");
    expect(cleanSummary("Fixed NPE in UserService")).toBe("Fixed NPE in UserService");
  });

  it("takes first line only", () => {
    expect(cleanSummary("Created signup endpoint\nSome reasoning")).toBe("Created signup endpoint");
  });

  it("strips surrounding quotes", () => {
    expect(cleanSummary('"Read config.json"')).toBe("Read config.json");
    expect(cleanSummary("'Ran failing tests'")).toBe("Ran failing tests");
    expect(cleanSummary("`Fixed bug`")).toBe("Fixed bug");
  });

  it("strips leading bullet/dash", () => {
    expect(cleanSummary("- Searched auth")).toBe("Searched auth");
    expect(cleanSummary("* Read files")).toBe("Read files");
    expect(cleanSummary("• Fixed NPE")).toBe("Fixed NPE");
  });

  it("strips Label:/Summary: prefixes", () => {
    expect(cleanSummary("Label: Fixed bug")).toBe("Fixed bug");
    expect(cleanSummary("Summary: Ran tests")).toBe("Ran tests");
    expect(cleanSummary("Label:Searched files")).toBe("Searched files");
  });

  it("rejects error messages", () => {
    expect(cleanSummary("API error: 500")).toBe("");
    expect(cleanSummary("Error: something went wrong")).toBe("");
    expect(cleanSummary("I cannot generate a summary")).toBe("");
    expect(cleanSummary("I can't help with that")).toBe("");
    expect(cleanSummary("Unable to determine")).toBe("");
  });

  it("caps length at 100 chars", () => {
    const long = "x".repeat(200);
    expect(cleanSummary(long).length).toBe(100);
  });

  it("returns empty for empty/whitespace input", () => {
    expect(cleanSummary("")).toBe("");
    expect(cleanSummary("   ")).toBe("");
    expect(cleanSummary("\n\n")).toBe("");
  });

  it("preserves CJK labels", () => {
    expect(cleanSummary("搜索了 auth 模块")).toBe("搜索了 auth 模块");
  });

  it("strips Unicode curly quotes", () => {
    expect(cleanSummary("“Read config.json”")).toBe("Read config.json");
    expect(cleanSummary("‘Ran tests’")).toBe("Ran tests");
  });

  it("strips CJK corner brackets", () => {
    expect(cleanSummary("「搜索了 auth 模块」")).toBe("搜索了 auth 模块");
    expect(cleanSummary("『Fixed bug』")).toBe("Fixed bug");
  });

  it("strips markdown emphasis markers", () => {
    expect(cleanSummary("**Read 4 files**")).toBe("Read 4 files");
    expect(cleanSummary("_Searched auth_")).toBe("Searched auth");
    expect(cleanSummary("__Fixed NPE__")).toBe("Fixed NPE");
  });

  it("rejects Chinese refusal responses", () => {
    expect(cleanSummary("我无法生成摘要")).toBe("");
    expect(cleanSummary("我不能回答这个")).toBe("");
    expect(cleanSummary("抱歉，我不能帮助")).toBe("");
    expect(cleanSummary("无法确定")).toBe("");
    expect(cleanSummary("无法完成")).toBe("");
  });

  it("rejects curly-apostrophe English refusals", () => {
    expect(cleanSummary("I can’t generate that")).toBe("");
  });

  it("rejects additional English refusal patterns", () => {
    expect(cleanSummary("Failed to read files")).toBe("");
    expect(cleanSummary("Sorry, I cannot")).toBe("");
    expect(cleanSummary("Request failed")).toBe("");
  });
});

describe("createToolUseSummaryMessage", () => {
  it("creates a message with generated uuid and timestamp", () => {
    const msg = createToolUseSummaryMessage("Fixed bug", ["call-1", "call-2"]);
    expect(msg.type).toBe("tool_use_summary");
    expect(msg.summary).toBe("Fixed bug");
    expect(msg.precedingToolUseIds).toEqual(["call-1", "call-2"]);
    expect(msg.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("generates distinct uuids", () => {
    const a = createToolUseSummaryMessage("a", []);
    const b = createToolUseSummaryMessage("b", []);
    expect(a.uuid).not.toBe(b.uuid);
  });
});

describe("generateToolUseSummary", () => {
  type SideQueryMock = ReturnType<typeof vi.fn<SideQuery>>;

  /** A side query that resolves with `text`. */
  const replying = (text: string): SideQueryMock => vi.fn<SideQuery>().mockResolvedValue(text);

  /**
   * Summarizes with the given fast-model side query (no fast model when
   * omitted) and one empty Read tool, unless `params` override.
   */
  const summarize = (
    sideQuery?: SideQueryMock,
    params: Partial<GenerateToolUseSummaryParams> = {},
  ) =>
    generateToolUseSummary({
      sideQuery,
      tools: [{ name: "Read", input: {}, output: "" }],
      signal: new AbortController().signal,
      ...params,
    });

  /** The user prompt text of the first model call. */
  const promptOf = (sideQuery: SideQueryMock) =>
    (sideQuery.mock.calls[0]?.[0] as SideQueryRequest).prompt;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when tools array is empty", async () => {
    expect(await summarize(replying("x"), { tools: [] })).toBeNull();
  });

  it("returns null when no fast model is configured", async () => {
    const result = await summarize(undefined, {
      tools: [{ name: "Read", input: { file: "a.ts" }, output: "..." }],
    });
    expect(result).toBeNull();
  });

  it("returns null when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const sideQuery = replying("x");
    expect(await summarize(sideQuery, { signal: ac.signal })).toBeNull();
    expect(sideQuery).not.toHaveBeenCalled();
  });

  it("calls model with the system prompt and upstream request budget", async () => {
    const sideQuery = replying("Searched in auth/");
    const result = await summarize(sideQuery, {
      tools: [{ name: "Grep", input: { pattern: "login" }, output: "3 matches" }],
    });

    expect(result).toBe("Searched in auth/");
    expect(sideQuery).toHaveBeenCalledTimes(1);

    const options = sideQuery.mock.calls[0]?.[0] as SideQueryRequest;
    expect(options.systemPrompt).toBe(TOOL_USE_SUMMARY_SYSTEM_PROMPT);
    expect(options.maxTokens).toBe(60);
    expect(options.temperature).toBe(0.3);

    const userText = promptOf(sideQuery);
    expect(userText).toContain("Tool: Grep");
    expect(userText).toContain('"pattern":"login"');
    expect(userText).toContain("3 matches");
    expect(userText).toContain("Label:");
  });

  it("includes lastAssistantText as intent prefix", async () => {
    const sideQuery = replying("Fixed auth bug");
    await summarize(sideQuery, {
      tools: [{ name: "Edit", input: {}, output: "" }],
      lastAssistantText: "I will now fix the authentication bug in the login flow.",
    });

    const userText = promptOf(sideQuery);
    expect(userText).toContain("User's intent (from assistant's last message):");
    expect(userText).toContain("fix the authentication bug");
  });

  it("truncates lastAssistantText to 200 chars", async () => {
    const sideQuery = replying("Done");
    await summarize(sideQuery, {
      tools: [{ name: "Edit", input: {}, output: "" }],
      lastAssistantText: "A".repeat(500),
    });

    const userText = promptOf(sideQuery);
    expect(userText).toContain("A".repeat(200));
    expect(userText).not.toContain("A".repeat(201));
  });

  it("returns null when model returns empty text", async () => {
    expect(await summarize(vi.fn<SideQuery>().mockResolvedValue(null))).toBeNull();
  });

  it("returns null when model call throws", async () => {
    const sideQuery = vi.fn<SideQuery>().mockRejectedValue(new Error("API error"));
    expect(await summarize(sideQuery)).toBeNull();
  });

  it("returns null when the signal aborts during the call", async () => {
    const ac = new AbortController();
    const sideQuery = vi.fn<SideQuery>().mockImplementation(async () => {
      ac.abort();
      throw new Error("aborted");
    });
    expect(await summarize(sideQuery, { signal: ac.signal })).toBeNull();
  });

  it("truncates tool input/output to 300 chars", async () => {
    const sideQuery = replying("Read file");
    await summarize(sideQuery, {
      tools: [
        {
          name: "Read",
          input: { content: "x".repeat(10000) },
          output: "y".repeat(10000),
        },
      ],
    });

    const userText = promptOf(sideQuery);
    expect(userText).not.toContain("x".repeat(500));
    expect(userText).not.toContain("y".repeat(500));
    expect(userText).toContain("...");
  });

  it("cleans markdown bullets / quotes from model output", async () => {
    const result = await summarize(replying('- "Searched auth/"'), {
      tools: [{ name: "Grep", input: {}, output: "" }],
    });
    expect(result).toBe("Searched auth/");
  });
});
