import { describe, expect, it, vi } from "vitest";
import { recoverTerminalReply, type RecoveryRequest } from "./run-recovery-text.js";

const scope = { sessionKey: "agent:main:recovery", agentId: "main", sessionId: "session" };
const result = {
  runId: "run",
  status: "ok",
  terminalReply: { disposition: "visible", text: "A bounded summary…" },
  terminalReceipt: {
    runId: "run",
    sessionId: "session",
    assistantTranscriptIdempotencyKey: "answer-occurrence",
  },
};
const metadata = { id: "answer", idempotencyKey: "answer-occurrence" };
const recover = (request: RecoveryRequest, terminal: unknown = result) =>
  recoverTerminalReply({
    runId: "run",
    scope,
    result: terminal,
    request,
    signal: new AbortController().signal,
  });

describe("shared terminal transcript recovery", () => {
  it("reads the receipt's full occurrence across history pages instead of the capped summary", async () => {
    const outputText = "complete answer ".repeat(2_000).trim();
    const request = vi.fn<RecoveryRequest>(async (method, params) => {
      if (method === "chat.message.get") {
        expect(params).toEqual({
          sessionKey: scope.sessionKey,
          agentId: scope.agentId,
          messageId: "answer",
        });
        return {
          ok: true,
          message: { role: "assistant", content: outputText, __branch: metadata },
        };
      }
      expect(method).toBe("chat.history");
      return {
        sessionId: "session",
        messages:
          params.offset === 200
            ? [
                {
                  role: "assistant",
                  content: "placeholder",
                  __branch: { ...metadata, truncated: true },
                },
              ]
            : [{ role: "assistant", content: "another run", __branch: { runId: "other" } }],
        hasMore: params.offset === undefined,
        nextOffset: 200,
      };
    });
    await expect(recover(request)).resolves.toEqual({ outputText });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["First item", "Second item", "First item\n\nSecond item"],
    ["First item\n", "\nSecond item", "First item\n\nSecond item"],
    [" First item\n\n", "\nSecond item ", " First item\n\n\nSecond item "],
  ])(
    "recovers every run item across pages with live display boundaries",
    async (first, second, outputText) => {
      const request = vi.fn<RecoveryRequest>(async (_method, params) => ({
        sessionId: "session",
        messages:
          params.offset === undefined
            ? [{ role: "assistant", content: second, __branch: { ...metadata, runId: "run" } }]
            : [
                { role: "assistant", content: "other", __branch: { runId: "other" } },
                { role: "assistant", content: first, __branch: { id: "first", runId: "run" } },
              ],
        hasMore: params.offset === undefined,
        nextOffset: 200,
      }));
      await expect(recover(request)).resolves.toEqual({ outputText });
    },
  );

  it("preserves the assistant text-block separator and display text types", async () => {
    await expect(
      recover(async () => ({
        sessionId: "session",
        messages: [
          {
            role: "assistant",
            __branch: metadata,
            content: [
              { type: "text", text: "First" },
              { type: "text", text: "  " },
              { type: "thinking", thinking: "hidden" },
              { type: "output_text", text: "Second" },
              { type: "input_text", text: "Third" },
              { type: "text", text: "\n" },
            ],
          },
        ],
      })),
    ).resolves.toEqual({ outputText: "First\n  \nSecond\nThird\n\n" });
  });

  it("ignores commentary projections that share the final occurrence's identity", async () => {
    await expect(
      recover(async () => ({
        sessionId: "session",
        messages: [
          {
            role: "assistant",
            content: "Thinking aloud",
            __branch: metadata,
            branchStreamFallback: { source: "segment", itemId: "commentary" },
          },
          { role: "assistant", content: "Answer", __branch: metadata },
        ],
      })),
    ).resolves.toEqual({ outputText: "Answer" });
  });

  it("does not label a partial history scan as the complete reply", async () => {
    const request = vi.fn<RecoveryRequest>(async (_method, params) => ({
      sessionId: "session",
      messages: [{ role: "assistant", content: "tail", __branch: metadata }],
      hasMore: true,
      nextOffset: Number(params.offset ?? 0) + 200,
    }));
    await expect(recover(request)).resolves.toEqual({ unavailable: "history-limit-reached" });
    expect(request).toHaveBeenCalledTimes(10);
  });

  it.each([
    { sessionId: "replacement", messages: [], reason: "session-changed" },
    {
      sessionId: "session",
      messages: [{ role: "assistant", content: "unrelated", __branch: { runId: "other" } }],
      reason: "reply-not-found",
    },
  ])(
    "reports $reason without promoting a summary or unrelated text",
    async ({ sessionId, messages, reason }) => {
      await expect(recover(async () => ({ sessionId, messages }))).resolves.toEqual({
        unavailable: reason,
      });
    },
  );

  it("rejects a full reader that returns a different assistant occurrence", async () => {
    await expect(
      recover(async (method) =>
        method === "chat.history"
          ? {
              sessionId: "session",
              messages: [
                {
                  role: "assistant",
                  content: "placeholder",
                  __branch: { ...metadata, truncated: true },
                },
              ],
            }
          : {
              ok: true,
              message: {
                role: "assistant",
                content: "wrong occurrence",
                __branch: { ...metadata, id: "other" },
              },
            },
      ),
    ).resolves.toEqual({ unavailable: "full-message-unavailable" });
  });

  it("uses exact run metadata when no receipt is available and respects silent outcomes", async () => {
    const request = vi.fn<RecoveryRequest>(async () => ({
      sessionId: "session",
      messages: [
        { role: "assistant", content: "expected", __branch: { runId: "run" } },
        { role: "assistant", content: "unrelated", __branch: { runId: "other" } },
      ],
    }));
    await expect(recover(request, { status: "ok" })).resolves.toEqual({ outputText: "expected" });
    await expect(recover(request, { terminalReply: { disposition: "silent" } })).resolves.toEqual({
      outputText: "",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
