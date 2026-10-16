import { describe, expect, it, vi } from "vitest";
import { createSerialReloader, loadAllTopicTranscripts, type TopicTranscriptCache } from "./topic-all";

const main = { key: "agent:oak:main", title: "General", updatedAt: 1, preview: "hello" };
const topics = [
  { key: "agent:oak:trip", title: "Trip", updatedAt: 2, preview: "flights" },
  { key: "agent:oak:food", title: "Food", updatedAt: 3, preview: "dinner" },
];

describe("All topics transcript reads", () => {
  it("re-reads only the threads whose rows moved since the last load", async () => {
    const request = vi.fn(async () => ({ messages: [] }));
    const cache: TopicTranscriptCache = new Map();
    await loadAllTopicTranscripts(request, main, topics, {}, cache);
    expect(request).toHaveBeenCalledTimes(3);

    await loadAllTopicTranscripts(request, main, [topics[0], { ...topics[1], updatedAt: 4, preview: "lunch" }], {}, cache);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenLastCalledWith("chat.history", { sessionKey: "agent:oak:food" });
  });

  it("runs at most one load at a time and collapses triggers during a load into one follow-up", async () => {
    let active = 0;
    let peak = 0;
    let runs = 0;
    const reloader = createSerialReloader(
      () =>
        new Promise<void>((settled) => {
          runs += 1;
          active += 1;
          peak = Math.max(peak, active);
          setTimeout(() => {
            active -= 1;
            settled();
          }, 5);
        }),
    );
    for (let index = 0; index < 20; index += 1) reloader.trigger();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(peak).toBe(1);
    expect(runs).toBe(2);
    reloader.cancel();
  });

  it("waits for every thread read before releasing the load when one read fails", async () => {
    let releaseTopic!: () => void;
    const held = new Promise<void>((resolve) => { releaseTopic = resolve; });
    let failMain = true;
    const calls: string[] = [];
    const request = vi.fn(async (_method: string, params: unknown) => {
      const key = (params as { sessionKey: string }).sessionKey;
      calls.push(key);
      if (key === main.key && failMain) throw new Error("main unavailable");
      if (key === topics[0].key) await held;
      return { messages: [] };
    });
    const cache: TopicTranscriptCache = new Map();
    const errors: unknown[] = [];
    let runs = 0;
    const reloader = createSerialReloader(async () => {
      runs += 1;
      try {
        await loadAllTopicTranscripts(request, main, [topics[0]], {}, cache);
      } catch (error) {
        errors.push(error);
        throw error;
      }
    });
    reloader.trigger();
    reloader.trigger();
    reloader.trigger();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs).toBe(1);
    expect(calls.filter((key) => key === topics[0].key)).toHaveLength(1);

    failMain = false;
    releaseTopic();
    await vi.waitFor(() => expect(calls.filter((key) => key === main.key)).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("main unavailable");
    expect(calls.filter((key) => key === topics[0].key)).toHaveLength(1);
    expect(cache.has(main.key)).toBe(true);
    reloader.cancel();
  });
});
