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
});
