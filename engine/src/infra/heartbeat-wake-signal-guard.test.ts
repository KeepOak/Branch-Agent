import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-event-wake.js", () => ({
  requestSessionEventWake: vi.fn(),
  requestSessionEventWakeAndWait: vi.fn(),
  setSessionEventWakeHandler: vi.fn(),
  areSessionEventWakesEnabled: vi.fn(),
  setSessionEventWakesEnabled: vi.fn(),
  getSessionEventWakeAbortSignal: vi.fn(),
  isRetryableSessionEventWakeReason: vi.fn(),
  SESSION_EVENT_IDLE_RETRY_MS: 60_000,
}));

import { requestHeartbeat, requestSignalWake } from "./heartbeat-wake.js";
import { requestSessionEventWake } from "./session-event-wake.js";

const SIGNAL_REQUEST = {
  source: "signal",
  intent: "immediate",
  reason: "ci-red",
  sessionKey: "agent:builder-1:main",
} as const;

describe("requestHeartbeat runtime guard", () => {
  beforeEach(() => {
    vi.mocked(requestSessionEventWake).mockClear();
  });

  it("refuses a signal source, even when the value is built indirectly", () => {
    const aliased = ["sig", "nal"].join("");
    expect(() => requestHeartbeat(SIGNAL_REQUEST)).toThrow(/requestSignalWake/);
    expect(() => requestHeartbeat({ ...SIGNAL_REQUEST, source: aliased as "signal" })).toThrow(
      /requestSignalWake/,
    );
    expect(requestSessionEventWake).not.toHaveBeenCalled();
  });

  it("passes every other source through unchanged", () => {
    requestHeartbeat({
      source: "notifications-event",
      intent: "immediate",
      reason: "wake",
      sessionKey: "agent:builder-1:main",
    });
    expect(requestSessionEventWake).toHaveBeenCalledTimes(1);
  });

  it("lets the internal signal entry send a signal wake", () => {
    requestSignalWake(SIGNAL_REQUEST);
    expect(requestSessionEventWake).toHaveBeenCalledWith(SIGNAL_REQUEST);
  });
});
