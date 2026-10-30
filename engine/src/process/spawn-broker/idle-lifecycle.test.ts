import { AsyncLocalStorage } from "node:async_hooks";
import { ChildProcess, type MessageOptions, type SendHandle } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpawnBrokerHost, type SpawnBrokerHost } from "./host.js";
import { SPAWN_BROKER_MAX_CONCURRENT } from "./protocol.js";
import { SPAWN_BROKER_STARTUP_TIMEOUT_MS } from "./resource-protocol.js";

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: native.spawn,
}));
// fileURLToPath needs a drive letter on Windows; the module is never loaded.
const syntheticRoot = process.platform === "win32" ? "file:///C:/synthetic" : "file:///synthetic";
vi.mock("../../infra/runtime-worker-url.js", () => ({
  resolveRuntimeWorkerUrl: () =>
    new URL(
      (process.platform === "win32" ? "file:///C:/synthetic" : "file:///synthetic") +
        "/spawn-broker.js",
    ),
  resolveRuntimeWorkerArgv: () => ["synthetic-spawn-broker"],
}));
vi.mock("./cleanup.js", () => ({
  terminateLostBrokerChild: () => ({ force: vi.fn(), settled: Promise.resolve() }),
  terminateBrokerProcessGroup: () => ({ force: vi.fn(), settled: Promise.resolve() }),
}));

const hosts: SpawnBrokerHost[] = [];

afterEach(async () => {
  try {
    await Promise.all(hosts.splice(0).map((host) => host.close()));
  } finally {
    native.spawn.mockReset();
    vi.restoreAllMocks();
  }
});

function mockBrokerChild(pid: number, options: { closeAfterDisconnect?: boolean } = {}) {
  const worker = new ChildProcess();
  let connected = true;
  let exited = false;
  let disconnected = false;
  const exit = () => {
    if (exited) {
      return;
    }
    exited = true;
    connected = false;
    worker.emit("exit", 0, null);
    // Like Node: an explicit parent disconnect can suppress the close event.
    if (!disconnected || options.closeAfterDisconnect !== false) {
      worker.emit("close", 0, null);
    }
  };
  const send = vi.fn(
    (
      _message: unknown,
      ...args: Array<SendHandle | MessageOptions | ((error: Error | null) => void) | undefined>
    ) => {
      args.find((arg) => typeof arg === "function")?.(null);
      return true;
    },
  );
  Object.defineProperties(worker, {
    pid: { value: pid },
    connected: { get: () => connected },
    exitCode: { get: () => (exited ? 0 : null) },
    signalCode: { get: () => null },
    send: { value: send },
    disconnect: {
      value: () => {
        connected = false;
        disconnected = true;
        worker.emit("disconnect");
        exit();
      },
    },
    kill: {
      value: () => {
        exit();
        return true;
      },
    },
  });
  return { worker, send };
}

function attachHost(host: SpawnBrokerHost): SpawnBrokerHost {
  hosts.push(host);
  return host;
}

describe("spawn broker baseline workers", () => {
  it("does not start a lazy host until first use", async () => {
    const host = attachHost(createSpawnBrokerHost({ lazyStart: true, idleTimeoutMs: 0 }));
    expect(native.spawn).not.toHaveBeenCalled();
    expect(host.pid).toBeUndefined();
    expect(host.activeWorkerCount).toBe(0);

    const { worker } = mockBrokerChild(51001);
    native.spawn.mockReturnValueOnce(worker);
    const ready = host.ready();
    worker.emit("message", { type: "ready", pid: 51001 });
    await ready;
    expect(native.spawn).toHaveBeenCalledOnce();
    expect(host.pid).toBe(51001);
    expect(host.activeWorkerCount).toBe(1);
  });

  it("tears the worker down after the idle timeout and starts again on next use", async () => {
    const pids = [51002, 51003];
    native.spawn.mockReset();
    native.spawn.mockImplementation(() => {
      const pid = pids.shift();
      if (pid === undefined) {
        throw new Error("unexpected extra broker spawn");
      }
      const { worker } = mockBrokerChild(pid);
      queueMicrotask(() => {
        worker.emit("message", { type: "ready", pid });
      });
      return worker;
    });
    const host = attachHost(createSpawnBrokerHost({ idleTimeoutMs: 20 }));
    await host.ready();
    expect(host.activeWorkerCount).toBe(1);
    expect(host.pid).toBe(51002);

    await delay(40);
    expect(host.pid).toBeUndefined();
    expect(host.activeWorkerCount).toBe(0);

    await host.ready();
    expect(host.pid).toBe(51003);
    expect(host.activeWorkerCount).toBe(1);
    expect(native.spawn).toHaveBeenCalledTimes(2);
  });

  it("holds the concurrency cap so load cannot admit extra in-flight spawns", async () => {
    const { worker } = mockBrokerChild(51004);
    native.spawn.mockReturnValueOnce(worker);
    const host = attachHost(createSpawnBrokerHost({ idleTimeoutMs: 0, maxConcurrent: 1 }));
    worker.emit("message", { type: "ready", pid: 51004 });
    await host.ready();

    const first = host.spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const second = host.spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    await expect(second.ready()).rejects.toMatchObject({
      name: "SpawnBrokerError",
      message: "Spawn broker request capacity exceeded",
    });
    expect(second.notStarted).toBe(true);
    expect(first.notStarted).toBe(false);
    expect(SPAWN_BROKER_MAX_CONCURRENT).toBe(256);
  });

  it("binds a native capture made while parking to the replacement broker", async () => {
    const first = mockBrokerChild(51005);
    const second = mockBrokerChild(51006);
    native.spawn.mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const host = attachHost(createSpawnBrokerHost({ nativeResources: true, idleTimeoutMs: 10 }));
    first.worker.emit("message", { type: "ready", pid: 51005 });
    await host.ready();
    // Parking waits for the retiring broker to exit after its shutdown request.
    await vi.waitFor(() => {
      expect(Reflect.get(host, "parking")).toBe(true);
    });
    const capturedAt = Date.now();
    const lease = host.captureNativeResource(
      { moduleUrl: syntheticRoot + "/resource.mjs", ownerPort: false },
      { message: vi.fn(), failed: vi.fn() },
    );
    try {
      // Generation 0 is the retiring broker; the attachment must target its replacement.
      expect(lease.attachment.generation).toBe(1);
      expect(lease.attachment.startupDeadline).toBeGreaterThan(
        capturedAt + SPAWN_BROKER_STARTUP_TIMEOUT_MS,
      );
      first.worker.kill();
      await vi.waitFor(() => {
        expect(native.spawn).toHaveBeenCalledTimes(2);
      });
      expect(second.send.mock.calls[0]?.[0]).toMatchObject({
        type: "bootstrap",
        nativeResource: { generation: 1 },
      });
      second.worker.emit("message", { type: "ready", pid: 51006 });
      await host.ready();
      expect(host.pid).toBe(51006);
    } finally {
      lease.abandonUnattached();
      // Exit both mock brokers so host close does not wait for the kill fallback.
      first.worker.kill();
      second.worker.kill();
    }
  });

  it("parks a plain broker whose explicit disconnect suppresses close", async () => {
    const pids = [51007, 51008];
    native.spawn.mockImplementation(() => {
      const pid = pids.shift();
      if (pid === undefined) {
        throw new Error("unexpected extra broker spawn");
      }
      const { worker } = mockBrokerChild(pid, { closeAfterDisconnect: false });
      queueMicrotask(() => {
        worker.emit("message", { type: "ready", pid });
      });
      return worker;
    });
    const host = attachHost(createSpawnBrokerHost({ idleTimeoutMs: 20 }));
    await host.ready();
    expect(host.pid).toBe(51007);

    // The Gateway broker parks by disconnecting; its exit, not close, ends the park.
    await vi.waitFor(() => {
      expect(Reflect.get(host, "parked")).toBe(true);
      expect(Reflect.get(host, "parking")).toBe(false);
    });
    expect(host.pid).toBeUndefined();

    // The next use starts a replacement instead of waiting behind the stalled park.
    await host.ready();
    expect(host.pid).toBe(51008);
    expect(native.spawn).toHaveBeenCalledTimes(2);
  });

  it("creates the idle timer outside the caller's async context", async () => {
    const { worker } = mockBrokerChild(51009);
    native.spawn.mockReturnValueOnce(worker);
    const request = new AsyncLocalStorage<{ request: string }>();
    const idleTimeoutMs = 43_210;
    const stores: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => {
      if (ms === idleTimeoutMs) {
        stores.push(request.getStore() ?? "detached");
      }
      return realSetTimeout(handler, ms);
    }) as typeof setTimeout);
    const host = attachHost(createSpawnBrokerHost({ idleTimeoutMs }));
    await request.run({ request: "caller" }, async () => {
      // Readiness arrives on the caller's turn and arms the idle timer there.
      worker.emit("message", { type: "ready", pid: 51009 });
      await host.ready();
    });
    expect(stores).toEqual(["detached"]);
  });
});
