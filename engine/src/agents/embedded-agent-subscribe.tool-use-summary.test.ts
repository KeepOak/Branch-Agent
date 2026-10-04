import type { ToolResultMessage } from "branch/plugin-sdk/llm";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { createSubscribedSessionHarness } from "./embedded-agent-subscribe.e2e-harness.js";
import { TOOL_USE_SUMMARY_EVENT_STREAM } from "./embedded-agent-subscribe.tool-use-summary.js";
import { makeAgentAssistantMessage } from "./test-helpers/agent-message-fixtures.js";
import { TOOL_USE_SUMMARY_SYSTEM_PROMPT } from "./tool-use-summary.js";

const sideCall = vi.hoisted(() => ({
  prepare: vi.fn(),
  run: vi.fn(),
}));

vi.mock("./utility-completion.js", () => ({
  prepareUtilityCompletionForAgent: sideCall.prepare,
}));
vi.mock("./isolated-completion.js", () => ({
  runIsolatedCompletion: sideCall.run,
}));

const BASE_CONFIG = {} as BranchConfig;

function toolTurn(results: Array<{ id: string; name: string; text: string; isError?: boolean }>) {
  const message = makeAgentAssistantMessage({
    content: [
      { type: "text", text: "Let me look for the login handler." },
      ...results.map((r) => ({
        type: "toolCall" as const,
        id: r.id,
        name: r.name,
        arguments: { pattern: "login" },
      })),
    ],
    stopReason: "toolUse",
  });
  const toolResults: ToolResultMessage[] = results.map((r) => ({
    role: "toolResult",
    toolCallId: r.id,
    toolName: r.name,
    content: [{ type: "text", text: r.text }],
    isError: r.isError ?? false,
    timestamp: 0,
  }));
  return { type: "turn_end", message, toolResults };
}

function subscribe(params: { config?: BranchConfig; sessionKey?: string } = {}) {
  const onAgentEvent = vi.fn();
  const harness = createSubscribedSessionHarness({
    runId: "run-labels",
    config: params.config ?? BASE_CONFIG,
    agentId: "main",
    sessionKey: params.sessionKey ?? "agent:main:main",
    onAgentEvent,
  });
  onTestFinished(() => harness.subscription.unsubscribe());
  const labels = () =>
    onAgentEvent.mock.calls
      .map(([evt]) => evt as { stream: string; data: Record<string, unknown> })
      .filter((evt) => evt.stream === TOOL_USE_SUMMARY_EVENT_STREAM);
  return { ...harness, labels };
}

afterEach(() => {
  sideCall.prepare.mockReset();
  sideCall.run.mockReset();
});

describe("tool-use batch labels on the subscribed session stream", () => {
  it("emits a utility-model label for a completed tool batch", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini", agentId: "main" });
    sideCall.run.mockResolvedValue({ text: '"Searched for login"' });
    const { emit, labels } = subscribe();

    emit(toolTurn([{ id: "call-1", name: "grep", text: "3 matches" }]));

    await vi.waitFor(() => expect(labels()).toHaveLength(1));
    expect(labels()[0]?.data).toMatchObject({
      type: "tool_use_summary",
      summary: "Searched for login",
      precedingToolUseIds: ["call-1"],
    });
    expect(sideCall.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "main", useUtilityModel: "required" }),
    );
    const request = sideCall.run.mock.calls[0]?.[0] as {
      systemPrompt: string;
      prompt: string;
      streamParams?: { maxTokens?: number; temperature?: number };
    };
    expect(request.systemPrompt).toBe(TOOL_USE_SUMMARY_SYSTEM_PROMPT);
    expect(request.prompt).toContain("Tool: grep");
    expect(request.prompt).toContain('"pattern":"login"');
    expect(request.prompt).toContain("Let me look for the login handler.");
    expect(request.streamParams).toEqual({ maxTokens: 60, temperature: 0.3 });
  });

  it("summarizes only the successful tools of a batch", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini" });
    sideCall.run.mockResolvedValue({ text: "Read config" });
    const { emit, labels } = subscribe();

    emit(
      toolTurn([
        { id: "ok", name: "read", text: "contents" },
        { id: "bad", name: "exec", text: "boom", isError: true },
      ]),
    );

    await vi.waitFor(() => expect(labels()).toHaveLength(1));
    expect(labels()[0]?.data.precedingToolUseIds).toEqual(["ok"]);
    const request = sideCall.run.mock.calls[0]?.[0] as { prompt: string };
    expect(request.prompt).not.toContain("Tool: exec");
  });

  it("skips batches with no successful tools and replies without tools", async () => {
    const { emit } = subscribe();

    emit(toolTurn([{ id: "bad", name: "exec", text: "boom", isError: true }]));
    emit(toolTurn([]));
    await Promise.resolve();

    expect(sideCall.prepare).not.toHaveBeenCalled();
  });

  it("stays off when emitToolUseSummaries is false", async () => {
    const { emit } = subscribe({
      config: { agents: { defaults: { emitToolUseSummaries: false } } } as BranchConfig,
    });

    emit(toolTurn([{ id: "call-1", name: "grep", text: "3 matches" }]));
    await Promise.resolve();

    expect(sideCall.prepare).not.toHaveBeenCalled();
  });

  it("skips subagent sessions", async () => {
    const sessionKey = "agent:main:subagent:child-1";
    expect(isSubagentSessionKey(sessionKey)).toBe(true);
    const { emit } = subscribe({ sessionKey });

    emit(toolTurn([{ id: "call-1", name: "grep", text: "3 matches" }]));
    await Promise.resolve();

    expect(sideCall.prepare).not.toHaveBeenCalled();
  });

  it("emits nothing when no utility model resolves", async () => {
    sideCall.prepare.mockRejectedValue(new Error("No utility model configured for agent main."));
    const { emit, labels } = subscribe();

    emit(toolTurn([{ id: "call-1", name: "grep", text: "3 matches" }]));

    await vi.waitFor(() => expect(sideCall.prepare).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sideCall.run).not.toHaveBeenCalled();
    expect(labels()).toEqual([]);
  });

  it("drops a label when a newer batch landed while it was in flight", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini" });
    let releaseFirst: (value: { text: string }) => void = () => {};
    sideCall.run
      .mockImplementationOnce(
        () =>
          new Promise<{ text: string }>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ text: "Ran tests" });
    const { emit, labels } = subscribe();

    emit(toolTurn([{ id: "first", name: "grep", text: "3 matches" }]));
    await vi.waitFor(() => expect(sideCall.run).toHaveBeenCalledTimes(1));
    emit(toolTurn([{ id: "second", name: "exec", text: "ok" }]));
    await vi.waitFor(() => expect(labels()).toHaveLength(1));
    releaseFirst({ text: "Searched for login" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(labels().map((evt) => evt.data.summary)).toEqual(["Ran tests"]);
  });
});
