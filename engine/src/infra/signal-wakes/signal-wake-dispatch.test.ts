import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { peekSystemEventEntries, resetSystemEventsForTest } from "../system-events.js";
import { dispatchSignalWake } from "./signal-wake-dispatch.js";
import { requestSignalWake } from "./signal-wake-internal.js";

vi.mock("./signal-wake-internal.js", () => ({ requestSignalWake: vi.fn() }));

const CFG = {} as BranchConfig;
const SIGNAL = {
  reason: "ci-red" as const,
  pr: 7,
  trunkId: "builder-1",
  contextKey: "signal:ci-red:7",
  text: "CI failed on PR #7 at aaaaaaa: build.",
};

describe("dispatchSignalWake", () => {
  beforeEach(() => {
    resetSystemEventsForTest();
    vi.mocked(requestSignalWake).mockClear();
  });

  it("queues the event on the Trunk's main session and wakes that Trunk once", () => {
    dispatchSignalWake(CFG, SIGNAL);
    dispatchSignalWake(CFG, SIGNAL);
    expect(requestSignalWake).toHaveBeenCalledTimes(1);
    expect(requestSignalWake).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "signal",
        intent: "immediate",
        reason: "ci-red",
        agentId: "builder-1",
      }),
    );
    const sessionKey = vi.mocked(requestSignalWake).mock.calls[0]?.[0].sessionKey ?? "";
    expect(peekSystemEventEntries(sessionKey).map((event) => event.contextKey)).toEqual([
      "signal:ci-red:7",
    ]);
  });
});
