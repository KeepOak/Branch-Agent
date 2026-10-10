import { describe, expect, it } from "vitest";
import { requestHeartbeat, requestHeartbeatAndWait } from "./heartbeat-wake.js";
import { assertWakeSourceAuthorized } from "./session-event-wake.js";

const SIGNAL_REQUEST = {
  source: "signal",
  intent: "immediate",
  reason: "ci-red",
  sessionKey: "agent:builder-1:main",
} as const;

describe("signal source guard at the session-event enqueue point", () => {
  it("refuses a signal through the fire-and-forget entry", () => {
    expect(() => requestHeartbeat(SIGNAL_REQUEST)).toThrow(/internal to the signal poller/);
  });

  it("refuses a signal through the wait entry used by cron", async () => {
    await expect(requestHeartbeatAndWait(SIGNAL_REQUEST)).rejects.toThrow(
      /internal to the signal poller/,
    );
  });

  it("refuses a signal whose source is built indirectly", async () => {
    const aliased = ["sig", "nal"].join("");
    await expect(
      requestHeartbeatAndWait({ ...SIGNAL_REQUEST, source: aliased as "signal" }),
    ).rejects.toThrow(/internal to the signal poller/);
  });

  it("lets other sources through the wait entry", async () => {
    const result = await requestHeartbeatAndWait({
      source: "notifications-event",
      intent: "immediate",
      reason: "wake",
      sessionKey: "agent:builder-1:main",
    });
    expect(result.status).toBe("skipped");
  });

  it("authorizes a signal only with the poller authority", () => {
    expect(() => assertWakeSourceAuthorized({ source: "signal" }, "signal-poller")).not.toThrow();
    expect(() => assertWakeSourceAuthorized({ source: "signal" })).toThrow();
    expect(() => assertWakeSourceAuthorized({ source: "cron" })).not.toThrow();
  });
});
