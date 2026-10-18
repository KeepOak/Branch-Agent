import { ChildProcess, type MessageOptions, type SendHandle } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpawnBrokerHost, type SpawnBrokerHost } from "./host.js";
import { SPAWN_BROKER_MAX_CONCURRENT } from "./protocol.js";

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: native.spawn,
}));
vi.mock("../../infra/runtime-worker-url.js", () => ({
  resolveRuntimeWorkerUrl: () => new URL("file:///synthetic/spawn-broker.js"),
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

function mockBrokerChild(pid: number) {
  const worker = new ChildProcess();
  let connected = true;
  let exited = false;
  const exit = () => {
    if (exited) {
      return;
    }
    exited = true;
    connected = false;
    worker.emit("exit", 0, null);
    worker.emit("close", 0, null);
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
    expect(SPAWN_BROKER_MAX_CONCURRENT).toBe(8);
  });
});
