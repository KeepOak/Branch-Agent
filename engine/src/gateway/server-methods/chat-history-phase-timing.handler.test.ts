import { afterEach, describe, expect, it, vi } from "vitest";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { chatHistoryHandlers } from "./chat-history-handler.js";
import { createHistoryReadContext } from "./chat-history.test-helpers.js";
import { identifiedClient } from "./sessions-read-cache.test-support.js";
import type { RespondFn } from "./types.js";

type HistoryContext = Awaited<ReturnType<typeof createHistoryReadContext>>;

/** Each clock read advances by `stepMs`, so any start-to-report span reflects the step. */
function stepClock(stepMs: number) {
  let reads = 0;
  return vi.spyOn(performance, "now").mockImplementation(() => {
    reads += 1;
    return (reads - 1) * stepMs;
  });
}

async function callChatHistory(context: HistoryContext) {
  const client = identifiedClient("phase-timing-viewer");
  client.connect.scopes = ["operator.admin"];
  const respond = vi.fn<RespondFn>();
  await chatHistoryHandlers["chat.history"]({
    params: { sessionKey: "agent:main:phase-timing" },
    context,
    client,
    respond,
    req: { type: "req", id: "phase-timing", method: "chat.history" },
    isWebchatConnect: () => false,
  } as never);
  return respond;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat history phase breakdown", () => {
  it("logs one breakdown line when the request takes longer than five seconds", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      stepClock(6_000);
      await callChatHistory(context);

      const slowLines = vi
        .mocked(context.logGateway.warn)
        .mock.calls.map(([message]) => String(message))
        .filter((message) => message.startsWith("slow chat history request"));
      expect(slowLines).toHaveLength(1);
      expect(slowLines[0]).toMatch(
        /^slow chat history request method=chat\.history totalMs=\d+ lookupMs=\d+ resolveMs=\d+ dbReadMs=\d+ projectionMs=\d+ sessionRowsMs=\d+ respondMs=\d+ unattributedMs=\d+$/,
      );
    });
  });

  it("logs nothing for a fast request", async () => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const context = await createHistoryReadContext();
      stepClock(0);
      await callChatHistory(context);

      const slowLines = vi
        .mocked(context.logGateway.warn)
        .mock.calls.filter(([message]) => String(message).startsWith("slow chat history"));
      expect(slowLines).toEqual([]);
    });
  });
});
