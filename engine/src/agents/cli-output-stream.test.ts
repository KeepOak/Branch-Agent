import { describe, expect, it } from "vitest";
import { createCliJsonlStreamingParser } from "./cli-output-stream.js";
import { joinJsonlFrames, claudeStreamEvent, claudeTextDelta } from "./cli-output.test-helpers.js";

type ParserOptions = Parameters<typeof createCliJsonlStreamingParser>[0];
const claudeBackend: ParserOptions["backend"] = {
  command: "claude",
  output: "jsonl",
  jsonlDialect: "claude-stream-json",
  sessionIdFields: ["session_id"],
};
function createParser(overrides: Partial<ParserOptions> = {}) {
  return createCliJsonlStreamingParser({
    backend: { ...claudeBackend, command: "local-cli" },
    providerId: "local-cli",
    onAssistantDelta: () => {},
    ...overrides,
  });
}
function createClaudeParser(overrides: Partial<ParserOptions> = {}) {
  return createParser({
    backend: { command: "claude", output: "jsonl", jsonlDialect: "claude-stream-json" },
    providerId: "claude-cli",
    ...overrides,
  });
}
function finishFrames(parser: ReturnType<typeof createParser>, ...frames: unknown[]) {
  parser.push(joinJsonlFrames(...frames, ""));
  parser.finish();
}
function result(text: string, fields: Record<string, unknown> = {}) {
  return { type: "result", result: text, ...fields };
}
function init(sessionId: string) {
  return { type: "init", session_id: sessionId };
}
const messageStart = claudeStreamEvent({ type: "message_start" });
const messageStop = claudeStreamEvent({ type: "message_stop" });
function toolStart(id = "tool-1", index?: number) {
  return claudeStreamEvent({
    type: "content_block_start",
    ...(index === undefined ? {} : { index }),
    content_block: {
      type: "tool_use",
      id,
      name: "Read",
      ...(index === undefined ? {} : { input: {} }),
    },
  });
}
function syntheticNoResponse(text = "No response requested.", model = "<synthetic>") {
  return {
    type: "assistant",
    message: { model, role: "assistant", content: [{ type: "text", text }] },
  };
}
const stoppedFailure = {
  errorText:
    "Claude CLI ended the turn without a reply (terminal_reason: hook_stopped, stop_reason: tool_use).",
  terminalFailure: {
    reason: "turn_stopped",
    terminalReason: "hook_stopped",
    stopReason: "tool_use",
  },
};

const parentUsage = { input: 12, output: 3, cacheRead: 4, cacheWrite: 7, total: undefined };
const parentUsageFrame = {
  type: "assistant",
  message: {
    id: "parent-message",
    role: "assistant",
    usage: {
      input_tokens: 12,
      output_tokens: 3,
      cache_read_input_tokens: 4,
      cache_creation_input_tokens: 7,
    },
  },
};
const childUsageFrames = [
  {
    type: "assistant",
    parent_tool_use_id: "child-call",
    message: {
      id: "child-message",
      role: "assistant",
      content: [{ type: "text", text: "Child work" }],
      usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 700 },
    },
  },
  {
    type: "result",
    parent_tool_use_id: "child-call",
    result: "Child done",
    usage: { input_tokens: 1000, output_tokens: 90, cache_read_input_tokens: 800 },
  },
];

describe("createCliJsonlStreamingParser", () => {
  it("keeps Claude child usage out of the parent's reply and diagnostic accounting", () => {
    const observed: unknown[] = [];
    const progress: string[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      onUsage: (usage, terminal) => observed.push({ ...usage, terminal }),
      onAttributedSubagentProgress: (id) => progress.push(id),
    });
    parser.push(
      joinJsonlFrames(
        parentUsageFrame,
        ...childUsageFrames,
        { type: "result", subtype: "success", result: "Parent done" },
        "",
      ),
    );
    parser.finish();
    expect(parser.getOutput()?.usage).toEqual(parentUsage);
    expect(parser.getOutput()?.diagnosticUsage).toBeUndefined();
    expect(observed).toEqual([{ ...parentUsage, terminal: false }]);
    expect(progress).toContain("child-call");
    expect(parser.getOutput()?.text).toBe("Parent done");
  });

  it("does not invent parent usage from child-only Claude usage records", () => {
    const observed: unknown[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      onUsage: (usage) => observed.push(usage),
    });
    parser.push(
      joinJsonlFrames(
        ...childUsageFrames,
        { type: "result", subtype: "success", result: "Parent done" },
        "",
      ),
    );
    parser.finish();
    expect(parser.getOutput()?.usage).toBeUndefined();
    expect(parser.getOutput()?.diagnosticUsage).toBeUndefined();
    expect(observed).toEqual([]);
  });

  it("keeps parent cumulative diagnostics when a later Claude child reports usage", () => {
    const observed: unknown[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      onUsage: (usage, terminal) => observed.push({ ...usage, terminal }),
    });
    parser.push(
      joinJsonlFrames(
        { ...parentUsageFrame, parent_tool_use_id: null },
        {
          type: "result",
          parent_tool_use_id: null,
          subtype: "success",
          result: "Parent done",
          usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 30 },
        },
        childUsageFrames[1],
        "",
      ),
    );
    parser.finish();
    expect(parser.getOutput()?.usage).toEqual(parentUsage);
    expect(parser.getOutput()?.diagnosticUsage?.input).toBe(50);
    expect(observed).toHaveLength(2);
    expect(observed[1]).toMatchObject({ input: 50, cacheRead: 30, terminal: true });
    expect(parser.getOutput()?.text).toBe("Parent done");
  });

  it("refuses to treat a Claude child's result as the parent's completion", () => {
    const completed: string[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      onCompletedReply: (text) => completed.push(text),
    });
    parser.push(joinJsonlFrames(...childUsageFrames, ""));
    parser.finish();
    expect(parser.getOutput()?.text).toBe("");
    expect(parser.getOutput()?.errorText).toMatch(/without a result event/);
    expect(completed).toEqual([]);
  });

  it("preserves usage on non-Claude JSONL records with an incidental parent field", () => {
    const observed: unknown[] = [];
    const parser = createParser({
      backend: { command: "local-cli", output: "jsonl" },
      providerId: "local-cli",
      onUsage: (usage) => observed.push(usage),
    });
    parser.push(
      joinJsonlFrames(
        {
          type: "result",
          parent_tool_use_id: "external-parent",
          result: "Generic done",
          usage: { input_tokens: 12, output_tokens: 3 },
        },
        "",
      ),
    );
    parser.finish();
    expect(observed).toMatchObject([{ input: 12, output: 3 }]);
  });

  it("does not project a Claude child's custom terminal result into the parent reply", () => {
    const projected: unknown[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      parseJsonlEvent: (line) => {
        const row = JSON.parse(line) as {
          type?: string;
          result?: string;
          parent_tool_use_id?: string;
        };
        projected.push(row.parent_tool_use_id ?? "parent");
        return row.type === "result" ? { kind: "result", text: row.result } : null;
      },
    });
    parser.push(
      joinJsonlFrames(childUsageFrames[1], { type: "result", result: "Parent done" }, ""),
    );
    parser.finish();
    expect(parser.getOutput()?.text).toBe("Parent done");
    expect(projected).toEqual(["parent"]);
  });

  it("does not project a Claude child's compaction status into the parent lifecycle", () => {
    const phases: string[] = [];
    const parser = createParser({
      providerId: "claude-cli",
      backend: claudeBackend,
      onCompaction: (event) => phases.push(event.phase),
      parseJsonlLifecycleEvent: (line) => {
        const row = JSON.parse(line) as { status?: string };
        return row.status === "compacting" ? { kind: "compaction", phase: "start" } : null;
      },
    });
    parser.push(
      joinJsonlFrames(
        { type: "system", status: "compacting", parent_tool_use_id: "child-call" },
        { type: "system", status: "compacting", parent_tool_use_id: null },
        { type: "result", result: "Parent done" },
        "",
      ),
    );
    parser.finish();
    expect(phases).toEqual(["start"]);
  });

  it.each([
    {
      name: "fresh and warm parent initialization",
      frames: [
        {
          type: "system",
          subtype: "init",
          session_id: "reused-session",
          tools: ["Read", "Bash", "mcp__branch__automations"],
        },
        result("first turn complete"),
        { type: "system", subtype: "init", session_id: "reused-session", tools: ["Read"] },
        result("warm turn complete"),
        { type: "system", subtype: "init", session_id: "replacement-session", tools: [] },
      ],
      expected: [["Read", "Bash", "mcp__branch__automations"], ["Read"], []],
    },
    {
      name: "subagent and non-initialization exclusion",
      frames: [
        { type: "system", subtype: "init", parent_tool_use_id: null, tools: ["Read"] },
        { type: "system", subtype: "init", parent_tool_use_id: "child-call", tools: ["Bash"] },
        { type: "system", subtype: "status", tools: [] },
        { type: "assistant", tools: ["Write"] },
      ],
      expected: [["Read"]],
    },
    {
      name: "malformed and missing lists left for owner validation",
      frames: [["Read"], "Bash", null, ["Read", 7], undefined].map((tools) => ({
        type: "system",
        subtype: "init",
        tools,
      })),
      expected: [["Read"], "Bash", null, ["Read", 7], undefined],
    },
  ])("observes native tools across chunked $name", ({ frames, expected }) => {
    const snapshots: unknown[] = [];
    const parser = createClaudeParser({ onNativeTools: (tools) => snapshots.push(tools) });
    const first = JSON.stringify(frames[0]);
    parser.push(first.slice(0, -2));
    expect(snapshots).toEqual([]);
    parser.push(first.slice(-2) + "\n" + joinJsonlFrames(...frames.slice(1)));
    parser.finish();
    expect(snapshots).toEqual(expected);
  });

  it("normalizes usage while incrementally streaming CLI JSONL", () => {
    const parser = createParser();
    finishFrames(
      parser,
      init("openai-compatible-session"),
      result("OpenAI-compatible response", {
        usage: {
          prompt_tokens: 17,
          completion_tokens: 5,
          total_tokens: 22,
          prompt_tokens_details: { cached_tokens: 6 },
        },
      }),
    );
    expect(parser.getOutput()).toEqual({
      text: "OpenAI-compatible response",
      sessionId: "openai-compatible-session",
      usage: { input: 11, output: 5, cacheRead: 6, cacheWrite: undefined, total: 22 },
    });
  });

  it.each([
    {
      name: "exact synthetic empty terminal",
      frames: [syntheticNoResponse()],
      expected: {
        text: "",
        errorText: "Claude CLI returned a synthetic no-response result.",
        terminalFailure: { reason: "synthetic_no_response" },
      },
    },
    {
      name: "ordinary lookalike",
      frames: [syntheticNoResponse(undefined, "claude-sonnet-4-6")],
      expected: { text: "" },
    },
    {
      name: "different synthetic text",
      frames: [syntheticNoResponse("No reply needed.")],
      expected: { text: "" },
    },
    {
      name: "real text",
      frames: [syntheticNoResponse(), claudeTextDelta("real answer")],
      expected: { text: "real answer" },
    },
    {
      name: "tool activity",
      frames: [
        {
          type: "assistant",
          message: {
            model: "claude-sonnet-4-6",
            role: "assistant",
            content: [{ type: "tool_use", id: "tool-1", name: "Read", input: {} }],
          },
        },
        syntheticNoResponse(),
      ],
      expected: { text: "", endedAfterToolCall: true },
    },
  ])("classifies $name without confusing legitimate empty replies", ({ frames, expected }) => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      ...frames,
      result("", { subtype: "success", session_id: "synthetic-session" }),
    );
    expect(parser.getOutput()).toEqual({
      ...expected,
      sessionId: "synthetic-session",
      usage: undefined,
    });
  });

  it.each([
    {
      name: "empty hook-stopped turn",
      frames: [],
      terminalReason: "hook_stopped",
      expected: { text: "", ...stoppedFailure },
    },
    {
      name: "hook stop after streamed reply",
      frames: [claudeTextDelta("streamed answer")],
      terminalReason: "hook_stopped",
      expected: { text: "streamed answer" },
    },
    {
      name: "backgrounded turn",
      frames: [],
      terminalReason: "background_requested",
      expected: { text: "" },
    },
    {
      name: "hook stop after an interim result",
      frames: [
        result("Agent is running. I'll let you know when it finishes.", {
          subtype: "success",
          terminal_reason: "completed",
        }),
      ],
      terminalReason: "hook_stopped",
      expected: { text: "", ...stoppedFailure },
    },
  ])("judges delivery for the current $name", ({ frames, terminalReason, expected }) => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      ...frames,
      result("", {
        subtype: "success",
        is_error: false,
        session_id: "hook-stopped",
        stop_reason: "tool_use",
        terminal_reason: terminalReason,
        num_turns: 4,
      }),
    );
    expect(parser.getOutput()).toEqual({
      ...expected,
      sessionId: "hook-stopped",
      usage: undefined,
    });
  });

  it.each([
    {
      name: "no result envelope",
      frames: [claudeTextDelta("hello")],
      expectedText: "hello",
      checkDelta: true,
    },
    {
      name: "empty result envelope",
      frames: [claudeTextDelta("hello"), claudeTextDelta(" world"), result("")],
      expectedText: "hello world",
    },
    {
      name: "tool split inside one message",
      frames: [
        messageStart,
        claudeTextDelta("Before."),
        toolStart(),
        claudeTextDelta("DONE"),
        result("DONE"),
      ],
      expectedText: "Before.\n\nDONE",
    },
    {
      name: "toolless closer after tool-using message",
      frames: [
        messageStart,
        claudeTextDelta("Before."),
        toolStart(),
        claudeTextDelta("After."),
        messageStop,
        messageStart,
        claudeTextDelta("DONE"),
        result("DONE"),
      ],
      expectedText: "Before.\n\nAfter.\n\nDONE",
    },
    {
      name: "existing newlines at message boundaries",
      frames: [
        messageStart,
        claudeTextDelta("Before.\n\n"),
        toolStart(),
        messageStart,
        claudeTextDelta("DONE"),
        result("DONE"),
      ],
      expectedText: "Before.\n\nDONE",
    },
    {
      name: "tool split after an ordinary boundary",
      frames: [
        messageStart,
        claudeTextDelta("Draft."),
        messageStop,
        messageStart,
        claudeTextDelta("Before."),
        toolStart(),
        claudeTextDelta("DONE"),
        result("DONE"),
      ],
      expectedText: "Before.\n\nDONE",
    },
    {
      name: "fresh message starting with a tool call",
      frames: [
        messageStart,
        claudeTextDelta("Draft."),
        messageStop,
        messageStart,
        toolStart(),
        claudeTextDelta("Fresh answer."),
        result("Fresh answer."),
      ],
      expectedText: "Fresh answer.",
    },
    {
      name: "message boundary without a tool split",
      frames: [
        messageStart,
        claudeTextDelta("Draft."),
        messageStop,
        messageStart,
        claudeTextDelta("Final answer."),
        result("Final answer."),
      ],
      expectedText: "Final answer.",
    },
    {
      name: "suffix match inside one message",
      frames: [
        messageStart,
        claudeTextDelta("discarded draft authoritative result"),
        result("authoritative result"),
      ],
      expectedText: "authoritative result",
    },
    {
      name: "divergent streamed text",
      frames: [claudeTextDelta("draft wording"), result("authoritative result")],
      expectedText: "authoritative result",
    },
  ])("resolves streamed/result precedence for $name", ({ frames, expectedText, checkDelta }) => {
    const deltas: Parameters<ParserOptions["onAssistantDelta"]>[0][] = [];
    const sessionIds: string[] = [];
    const parser = createParser({
      onAssistantDelta: (delta) => deltas.push(delta),
      onSessionId: (id) => sessionIds.push(id),
    });
    finishFrames(parser, init("session-stream"), ...frames);
    expect(parser.getOutput()).toEqual({
      text: expectedText,
      sessionId: "session-stream",
      usage: undefined,
    });
    if (checkDelta) {
      expect(deltas).toEqual([
        { text: "hello", delta: "hello", sessionId: "session-stream", usage: undefined },
      ]);
      expect(sessionIds).toEqual(["session-stream"]);
    }
  });

  it("keeps pre-tool text and reconstructible deltas without a commentary consumer", () => {
    const deltas: Array<{ text: string; delta: string }> = [];
    const parser = createParser({ onAssistantDelta: (delta) => deltas.push(delta) });
    finishFrames(
      parser,
      init("session-tool-split"),
      messageStart,
      claudeTextDelta("Before."),
      toolStart(),
      messageStop,
      messageStart,
      claudeTextDelta("DONE"),
      result("DONE"),
    );
    expect(parser.getOutput()).toEqual({
      text: "Before.\n\nDONE",
      sessionId: "session-tool-split",
      usage: undefined,
    });
    expect(deltas.map((entry) => entry.delta).join("")).toBe("Before.\n\nDONE");
    expect(deltas.at(-1)?.text).toBe("Before.\n\nDONE");
  });

  it("judges post-interim-result segments on their own stream state", () => {
    const deltas: Array<{ text: string; delta: string }> = [];
    const parser = createParser({ onAssistantDelta: (delta) => deltas.push(delta) });
    finishFrames(
      parser,
      init("session-interim"),
      messageStart,
      claudeTextDelta("Interim answer."),
      result("Interim answer."),
      messageStart,
      claudeTextDelta("Pre-tool follow-up."),
      toolStart("tool-2"),
      claudeTextDelta("DONE"),
      result("DONE"),
    );
    expect(parser.getOutput()?.text).toBe("Interim answer.\nPre-tool follow-up.\n\nDONE");
    expect(deltas.at(-1)?.text).toBe("Interim answer.\n\nPre-tool follow-up.\n\nDONE");
    expect(deltas.map((entry) => entry.delta).join("")).toBe(
      "Interim answer.\n\nPre-tool follow-up.\n\nDONE",
    );
  });

  it.each([
    { name: "no preceding text", frames: [toolStart("toolu_1", 0)], expected: [] },
    {
      name: "consecutive tool blocks",
      frames: [
        claudeTextDelta("First, checking files."),
        toolStart("toolu_1", 1),
        toolStart("toolu_2", 2),
      ],
      expected: ["First, checking files."],
    },
    {
      name: "new text segments",
      frames: [
        claudeTextDelta("Reading the file now."),
        toolStart("toolu_a", 1),
        claudeTextDelta(" Now searching."),
        toolStart("toolu_b", 3),
      ],
      expected: ["Reading the file now.", "Now searching."],
    },
  ])("emits commentary once for $name", ({ frames, expected }) => {
    const commentaryTexts: string[] = [];
    const parser = createClaudeParser({ onCommentaryText: (text) => commentaryTexts.push(text) });
    finishFrames(parser, init("session-commentary"), ...frames);
    expect(commentaryTexts).toEqual(expected);
  });
});

it.each([
  { name: "discrete", results: ["First answer.", "Second answer.", "Final answer."] },
  { name: "shared lexical prefix", results: ["Hi", "History matters.", "Final answer."] },
  {
    name: "shared paragraph prefix",
    results: ["First answer.", "First answer.\nMore detail.", "Final answer."],
  },
])(
  "delivers completed $name results before settlement and retains retry boundaries",
  ({ results }) => {
    const completed: string[] = [];
    const indices: number[] = [];
    const parser = createClaudeParser({
      onCompletedReply: (text, index) => {
        completed.push(text);
        indices.push(index);
      },
    });
    for (const text of results.slice(0, 2)) {
      parser.push(
        joinJsonlFrames(result(text, { subtype: "success", branch_interim_result: true }), ""),
      );
    }
    expect(completed).toEqual(results.slice(0, 2));
    expect(indices).toEqual([0, 1]);
    finishFrames(parser, result("Final answer.", { subtype: "success" }));
    expect(completed).toEqual(results.slice(0, 2));
    expect(parser.getOutput()).toMatchObject({ text: results.join("\n"), textParts: results });
  },
);

it("does not redeliver repeated or empty held result acknowledgments", () => {
  const completed: string[] = [];
  const parser = createClaudeParser({ onCompletedReply: (text) => completed.push(text) });
  for (const text of [
    "First answer.",
    "",
    "First answer.",
    "Second answer.",
    "Second answer.",
    "",
  ]) {
    parser.push(
      joinJsonlFrames(result(text, { subtype: "success", branch_interim_result: true }), ""),
    );
  }
  parser.finish();
  expect(completed).toEqual(["First answer.", "Second answer."]);
  expect(parser.getOutput()).toMatchObject({
    text: "First answer.\nSecond answer.",
    textParts: ["First answer.", "Second answer."],
  });
  expect(parser.hasTerminalResult()).toBe(false);
  parser.push(joinJsonlFrames(result("Second answer.", { subtype: "success" }), ""));
  expect(parser.hasTerminalResult()).toBe(true);
  expect(parser.getOutput()?.textParts).toEqual(["First answer.", "Second answer."]);
});

it.each([
  {
    subtype: "error_during_execution",
    is_error: true,
    result: "Failed answer",
    errors: ["synthetic failure"],
  },
  { subtype: "success", result: "", terminal_reason: "hook_stopped", stop_reason: "tool_use" },
])("does not dispatch failed held results: $subtype $terminal_reason", (fields) => {
  const completed: string[] = [];
  const parser = createClaudeParser({ onCompletedReply: (text) => completed.push(text) });
  finishFrames(parser, { type: "result", ...fields, branch_interim_result: true });
  expect(completed).toEqual([]);
  expect(parser.getOutput()?.errorText).toBeTruthy();
});

describe("Claude turns that end on a tool call (#847)", () => {
  const narrationWithTool = {
    type: "assistant",
    message: {
      id: "msg-narration",
      role: "assistant",
      content: [
        { type: "text", text: "Running tests now" },
        { type: "tool_use", id: "toolu-tests", name: "Bash", input: { command: "run-tests" } },
      ],
    },
  };
  const toolResult = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu-tests", content: "3 passed" }],
    },
  };
  const closingMessage = {
    type: "assistant",
    message: {
      id: "msg-closing",
      role: "assistant",
      content: [{ type: "text", text: "All 3 tests pass." }],
    },
  };
  const emptySuccess = result("", { subtype: "success", session_id: "tool-final-session" });

  it("flags a turn whose last output is a tool call and drops the pre-tool narration", () => {
    const parser = createClaudeParser();
    finishFrames(parser, narrationWithTool, toolResult, emptySuccess);
    expect(parser.getOutput()).toEqual({
      text: "",
      endedAfterToolCall: true,
      sessionId: "tool-final-session",
      usage: undefined,
    });
  });

  it("flags a streamed turn whose last output is a tool call", () => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      messageStart,
      claudeTextDelta("Running tests now"),
      toolStart("toolu-tests", 1),
      messageStop,
      toolResult,
      emptySuccess,
    );
    expect(parser.getOutput()).toMatchObject({ text: "", endedAfterToolCall: true });
  });

  it("flags the turn when pre-tool narration was routed to commentary", () => {
    const commentary: string[] = [];
    const parser = createClaudeParser({ onCommentaryText: (text) => commentary.push(text) });
    finishFrames(
      parser,
      messageStart,
      claudeTextDelta("Running tests now"),
      toolStart("toolu-tests", 1),
      messageStop,
      toolResult,
      emptySuccess,
    );
    expect(commentary).toEqual(["Running tests now"]);
    expect(parser.getOutput()).toMatchObject({ text: "", endedAfterToolCall: true });
  });

  it("keeps text written after the last tool result as a normal success", () => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      narrationWithTool,
      toolResult,
      closingMessage,
      result("All 3 tests pass.", { subtype: "success", session_id: "tool-final-session" }),
    );
    const output = parser.getOutput();
    expect(output?.text).toMatch(/All 3 tests pass\.$/);
    expect(output?.endedAfterToolCall).toBeUndefined();
    expect(output?.errorText).toBeUndefined();
  });

  it("keeps streamed post-tool text when the result envelope is empty", () => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      messageStart,
      claudeTextDelta("Running tests now"),
      toolStart("toolu-tests", 1),
      messageStop,
      toolResult,
      messageStart,
      claudeTextDelta("All 3 tests pass."),
      messageStop,
      emptySuccess,
    );
    const output = parser.getOutput();
    expect(output?.text).toMatch(/All 3 tests pass\.$/);
    expect(output?.endedAfterToolCall).toBeUndefined();
  });

  it("does not flag a snapshot-only turn whose closing snapshot has text", () => {
    const parser = createClaudeParser();
    finishFrames(parser, narrationWithTool, toolResult, closingMessage, emptySuccess);
    expect(parser.getOutput()?.endedAfterToolCall).toBeUndefined();
  });

  it("fails a stopped turn that has only pre-tool text with its plain stop reason", () => {
    const parser = createClaudeParser();
    finishFrames(
      parser,
      messageStart,
      claudeTextDelta("Running tests now"),
      toolStart("toolu-tests", 1),
      messageStop,
      toolResult,
      result("", {
        subtype: "success",
        is_error: false,
        session_id: "hook-stopped",
        stop_reason: "tool_use",
        terminal_reason: "hook_stopped",
      }),
    );
    expect(parser.getOutput()).toEqual({
      text: "",
      ...stoppedFailure,
      sessionId: "hook-stopped",
      usage: undefined,
    });
  });
});
