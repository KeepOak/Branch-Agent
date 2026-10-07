import { describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import { getFreePort } from "../../test-utils/ports.js";
import {
  isStandbyPortPlaceholderHeld,
  releaseStandbyPortPlaceholder,
} from "../../infra/standby-port-placeholder.js";
import {
  GATEWAY_STANDBY_READY_MESSAGE,
  GATEWAY_STANDBY_TAKE_OVER_MESSAGE,
  GATEWAY_STANDBY_TAKING_OVER_MESSAGE,
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
        takeOverSignal: async () => {},
      },
    );
    // Ready, three polls until the owner released, then the taking-over notice.
    expect(order).toEqual(["warm", "notify", "poll", "poll", "poll", "notify"]);
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
          takeOverSignal: async () => {},
        },
      ),
    ).rejects.toThrow("launcher went away");
    expect(hasLiveOwner.mock.calls.length).toBeLessThanOrEqual(1);
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
          takeOverSignal: async () => {},
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
        takeOverSignal: async () => {},
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
    // Still held after the standby resolved: bootstrap, the lock and activation run before the real bind.
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect(isStandbyPortPlaceholderHeld(port)).toBe(true);
    // The real gateway's listen helper frees it right before binding.
    await releaseStandbyPortPlaceholder(port);
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

  it("never takes over on a bare lock release, such as the owner restarting in place: only on the launcher's word", async () => {
    let signal!: () => void;
    const takeOver = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const polls: boolean[] = [];
    const notify = vi.fn();
    let done = false;
    const standby = waitInGatewayStandby(
      {},
      {
        warm: async () => {},
        // The owner released the lock (restarting in place): no owner from the first poll on.
        hasLiveOwner: async () => {
          polls.push(false);
          return false;
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        notify,
        launcherGone: () => false,
        takeOverSignal: () => takeOver,
      },
    ).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(done).toBe(false);
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: GATEWAY_STANDBY_TAKING_OVER_MESSAGE }));
    signal();
    await standby;
    expect(done).toBe(true);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: GATEWAY_STANDBY_TAKING_OVER_MESSAGE, pid: process.pid }),
    );
  });

  it("waits for the state to be free even after the launcher said to take over", async () => {
    let owner = true;
    const standby = waitInGatewayStandby(
      {},
      {
        warm: async () => {},
        hasLiveOwner: async () => owner,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        notify: () => {},
        launcherGone: () => false,
        takeOverSignal: async () => {},
      },
    );
    let done = false;
    void standby.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(done).toBe(false);
    owner = false;
    await standby;
  });

  it("hears the launcher's take-over message even when it arrives before the standby reports ready", async () => {
    const sent: string[] = [];
    const standby = waitInGatewayStandby(
      {},
      {
        // A fast launcher: the message lands while the standby is still warming.
        warm: async () => {
          process.emit("message", { type: "something-else" }, undefined);
          process.emit("message", { type: GATEWAY_STANDBY_TAKE_OVER_MESSAGE }, undefined);
        },
        hasLiveOwner: async () => false,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        notify: (message) => sent.push(message.type),
        launcherGone: () => false,
        launchedWithChannel: true,
      },
    );
    await standby;
    expect(sent).toEqual([GATEWAY_STANDBY_READY_MESSAGE, GATEWAY_STANDBY_TAKING_OVER_MESSAGE]);
  });

  it("refuses to run as a standby without a launcher that can tell it to take over", async () => {
    await expect(
      waitInGatewayStandby(
        {},
        { warm: async () => {}, hasLiveOwner: async () => false, notify: () => {}, launchedWithChannel: false },
      ),
    ).rejects.toThrow(/IPC channel/);
  });
});
