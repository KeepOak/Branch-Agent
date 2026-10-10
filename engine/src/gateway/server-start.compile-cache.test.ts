import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";

const mocks = vi.hoisted(() => ({
  flushCompileCache: vi.fn(),
  schedule: vi.fn(),
  startupSettled: Promise.resolve(),
  lifecycle: { closePreludeStarted: false },
}));

vi.mock("node:module", async (importOriginal) =>
  Object.assign({}, await importOriginal<typeof import("node:module")>(), {
    flushCompileCache: mocks.flushCompileCache,
  }),
);
vi.mock("./server-kernel.js", () => ({
  gatewayKernelLogs: {},
  prepareGatewayKernel: async () => ({
    activationOptions: {},
    activate: async () => ({
      minimalTestGateway: true,
      lifecycle: mocks.lifecycle,
      scheduler: { schedule: mocks.schedule },
      createHttpTransportOptions: () => ({}),
      transportBridge: { attach: vi.fn() },
      tailscaleMode: "off",
      kernel: {},
    }),
  }),
}));
vi.mock("./server-runtime-state.js", () => ({ createGatewayHttpTransport: async () => ({}) }));
vi.mock("./server-startup-finish.js", () => ({
  finishGatewayStartup: async () => ({ startupSettled: mocks.startupSettled }),
}));
vi.mock("../skills/runtime/refresh-state.js", () => ({ bumpSkillsSnapshotVersion: vi.fn() }));

const { startGatewayServerCore } = await import("./server-start.js");

describe("Gateway startup compile cache", () => {
  beforeEach(() => {
    mocks.flushCompileCache.mockClear();
    mocks.schedule.mockClear();
    mocks.lifecycle.closePreludeStarted = false;
  });

  it("publishes the cold-start cache after settlement and before background work", async () => {
    const settled = createDeferred();
    mocks.startupSettled = settled.promise;
    const server = await startGatewayServerCore(0, { updateCanary: true });
    expect(mocks.flushCompileCache).not.toHaveBeenCalled();
    settled.resolve();
    await server.startupSettled;
    expect(mocks.flushCompileCache).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.flushCompileCache.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.schedule.mock.invocationCallOrder[0]!,
    );
  });

  it("does not start a cache write after shutdown has begun", async () => {
    const settled = createDeferred();
    mocks.startupSettled = settled.promise;
    const server = await startGatewayServerCore(0, { updateCanary: true });
    mocks.lifecycle.closePreludeStarted = true;
    settled.resolve();
    await server.startupSettled;
    expect(mocks.flushCompileCache).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
