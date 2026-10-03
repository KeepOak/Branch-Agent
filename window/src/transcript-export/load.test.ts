// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/utils/transcript-export/load-complete-events.test.ts (atlas SESSIONS-0047). Ported pagination invariants to the gateway contract.
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { loadCompleteTranscript } from "./load";

const message = (id: number) => ({ role: "user", content: `Message ${id}`, timestamp: id + 1, __branch: { id: `id-${id}` } });
const engine = (request: ReturnType<typeof vi.fn>): WindowEngine => ({ request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.read"], sessionKey: "a" });

describe("complete transcript history", () => {
  it("loads beyond the visible tail in chronological order", async () => {
    const request = vi.fn().mockResolvedValueOnce({ sessionId: "s", messages: [message(2), message(3)], hasMore: true, nextOffset: 2, totalMessages: 4 })
      .mockResolvedValueOnce({ sessionId: "s", messages: [message(0), message(1)], hasMore: false, totalMessages: 4 });
    const blocks = await loadCompleteTranscript(engine(request), "a", new AbortController().signal);
    expect(blocks.filter(b => b.kind === "user").map(b => b.text)).toEqual(["Message 0", "Message 1", "Message 2", "Message 3"]);
    expect(request).toHaveBeenNthCalledWith(2, "chat.history", { sessionKey: "a", offset: 2, limit: 100 });
  });
  it("deduplicates overlapping pages without losing equal timestamp messages", async () => {
    const request = vi.fn().mockResolvedValueOnce({ messages: [message(1), message(2)], hasMore: true, nextOffset: 2 })
      .mockResolvedValueOnce({ messages: [message(0), message(1)], hasMore: false });
    const blocks = await loadCompleteTranscript(engine(request), "a", new AbortController().signal);
    expect(blocks.filter(b => b.kind === "user")).toHaveLength(3);
  });
  it.each([
    [{ messages: [] }, "cannot prove"],
    [{ messages: [], hasMore: true, nextOffset: 0 }, "did not advance"],
    [{ messages: [], hasMore: true, nextOffset: NaN }, "did not advance"],
    [{ messages: [], hasMore: false, omission: { omittedCount: 1 } }, "omitted"],
    [{ hasMore: false }, "Invalid"],
    [{ messages: [{ __branch: { truncated: true } }], hasMore: false }, "omitted"],
  ])("rejects incomplete or malformed history %#", async (page, error) => {
    await expect(loadCompleteTranscript(engine(vi.fn().mockResolvedValue(page)), "a", new AbortController().signal)).rejects.toThrow(error);
  });
  it("rejects transcript replacement or appended turns between pages", async () => {
    for (const second of [{ sessionId: "replaced", totalMessages: 4 }, { sessionId: "s", totalMessages: 5 }]) {
      const request = vi.fn().mockResolvedValueOnce({ sessionId: "s", totalMessages: 4, messages: [message(2)], hasMore: true, nextOffset: 1 })
        .mockResolvedValueOnce({ ...second, messages: [message(1)], hasMore: false });
      await expect(loadCompleteTranscript(engine(request), "a", new AbortController().signal)).rejects.toThrow("changed while exporting");
    }
  });
  it("honors cancellation before and after an awaited gateway request", async () => {
    const abort = new AbortController();
    const request = vi.fn().mockImplementation(async () => { abort.abort(); return { messages: [], hasMore: false }; });
    await expect(loadCompleteTranscript(engine(request), "a", abort.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    await expect(loadCompleteTranscript(engine(request), "a", abort.signal)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
