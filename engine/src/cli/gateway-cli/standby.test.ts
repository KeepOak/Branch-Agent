import { describe, expect, it, vi } from "vitest";
import { GATEWAY_STANDBY_READY_MESSAGE, waitInGatewayStandby } from "./standby.js";

describe("gateway standby", () => {
  it("warms before reporting ready, then waits until the current owner releases state", async () => {
    const order: string[] = [];
    const owners = [true, true, false];
    const notify = vi.fn(() => {
      order.push("notify");
    });
    const result = await waitInGatewayStandby(
      {},
      {
        warm: async () => {
          order.push("warm");
        },
        hasLiveOwner: async () => {
          order.push("poll");
          return owners.shift() ?? false;
        },
        sleep: async () => {},
        notify,
        launcherGone: () => false,
      },
    );
    expect(order).toEqual(["warm", "notify", "poll", "poll", "poll"]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: GATEWAY_STANDBY_READY_MESSAGE, pid: process.pid }),
    );
    expect(result.waitMs).toBeGreaterThanOrEqual(0);
  });

  it("never takes over once its launcher is gone", async () => {
    const hasLiveOwner = vi.fn(async () => true);
    await expect(
      waitInGatewayStandby(
        {},
        {
          warm: async () => {},
          hasLiveOwner,
          sleep: async () => {},
          notify: () => {},
          launcherGone: () => true,
        },
      ),
    ).rejects.toThrow("launcher went away");
    expect(hasLiveOwner).toHaveBeenCalledOnce();
  });
});
