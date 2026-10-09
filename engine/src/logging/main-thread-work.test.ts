import { afterEach, describe, expect, it } from "vitest";
import { recordMainThreadWork, takeMainThreadWorkSummary } from "./main-thread-work.js";

afterEach(() => {
  takeMainThreadWorkSummary();
});

describe("main-thread work tally", () => {
  it("names the heaviest entries first and clears them when taken", () => {
    recordMainThreadWork("sqlite", "session.transcript.append", 40);
    recordMainThreadWork("sqlite", "session.transcript.append", 10);
    recordMainThreadWork("rpc-send", "chat.history", 25);
    recordMainThreadWork("broadcast", "chat.delta", 3);

    expect(takeMainThreadWorkSummary()).toBe(
      "sqlite:session.transcript.append=50ms/2,rpc-send:chat.history=25ms/1,broadcast:chat.delta=3ms/1",
    );
    expect(takeMainThreadWorkSummary()).toBe("");
  });

  it("keeps the report to the five heaviest entries", () => {
    for (let index = 0; index < 7; index += 1) {
      recordMainThreadWork("rpc-send", `method.${index}`, index + 1);
    }
    const summary = takeMainThreadWorkSummary();
    expect(summary.split(",")).toHaveLength(5);
    expect(summary.startsWith("rpc-send:method.6=7ms/1,")).toBe(true);
  });

  it("folds names past the per-category cap into one overflow entry", () => {
    for (let index = 0; index < 70; index += 1) {
      recordMainThreadWork("rpc-send", `method.${index}`, 1);
    }
    const summary = takeMainThreadWorkSummary();
    expect(summary).toContain("rpc-send:other=6ms/6");
  });
});
