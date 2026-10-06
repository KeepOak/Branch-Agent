import { describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import { getFreePort } from "../../test-utils/ports.js";
import {
  GATEWAY_STANDBY_READY_MESSAGE,
  listenGatewayStandbyPort,
  waitInGatewayStandby,
} from "./standby.js";

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

  it("never starts alone when its launcher quit after the owner was already gone", async () => {
    await expect(
      waitInGatewayStandby(
        {},
        {
          warm: async () => {},
          hasLiveOwner: async () => false,
          sleep: async () => {},
          notify: () => {},
          launcherGone: () => true,
        },
      ),
    ).rejects.toThrow("launcher went away");
  });

  it("serves its own port, never ready, until the owner releases state; then frees it for the real gateway", async () => {
    const port = await getFreePort();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let owner = true;
    void released.then(() => {
      owner = false;
    });
    const notify = vi.fn();
    const standby = waitInGatewayStandby(
      { BRANCH_GATEWAY_PORT: String(port) },
      {
        warm: async () => {},
        hasLiveOwner: async () => owner,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        notify,
        launcherGone: () => false,
      },
    );
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: GATEWAY_STANDBY_READY_MESSAGE, port }),
    );
    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.json()).toEqual({ ok: true, standby: true });
    const readyz = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(readyz.status).toBe(503);
    expect(await readyz.json()).toEqual({ ready: false, failing: ["standby"] });
    release();
    await standby;
    // The port is free again for the real gateway.
    const real = createServer();
    await new Promise<void>((resolve, reject) => {
      real.once("error", reject);
      real.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => real.close(() => resolve()));
  });

  it("refuses WebSocket connections on the standby port", async () => {
    const listener = await listenGatewayStandbyPort(0);
    try {
      const status = await new Promise<number | undefined>((resolve) => {
        const request = httpRequest({
          host: "127.0.0.1",
          port: listener.port,
          path: "/",
          headers: { connection: "Upgrade", upgrade: "websocket" },
        });
        request.on("upgrade", () => resolve(101));
        request.on("response", (response) => resolve(response.statusCode));
        request.on("error", () => resolve(undefined));
        request.end();
      });
      expect(status).toBeUndefined();
    } finally {
      await listener.close();
    }
  });
});
