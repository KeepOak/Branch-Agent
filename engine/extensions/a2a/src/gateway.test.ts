import {
  createPluginRuntimeMock,
  createStartAccountContext,
} from "branch/plugin-sdk/channel-test-helpers";
import {
  createTestRegistry,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "branch/plugin-sdk/plugin-test-runtime";
import {
  createMockIncomingRequest,
  createMockServerResponse,
} from "branch/plugin-sdk/test-env";
import { registerPluginHttpRoute } from "branch/plugin-sdk/webhook-ingress";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startA2aGatewayAccount } from "./gateway.js";
import { createMemoryBlobStore } from "./memory-blob-store.test-support.js";
import { A2A_TASK_BLOB_STORE_OPTIONS, A2aStateTaskPersistence } from "./persistence.js";
import { A2A_RESTART_INTERRUPTED_MESSAGE } from "./task-store.js";
import { setA2aChannelRuntime } from "./runtime.js";
import type { ResolvedA2aChannelAccount } from "./types.js";

afterEach(() => {
  resetPluginRuntimeStateForTest();
});

function createA2aGatewayFixture() {
  const registry = createTestRegistry([]);
  setActivePluginRegistry(registry);
  const runtime = createPluginRuntimeMock();
  const blobStore = createMemoryBlobStore<{ taskId: string; ownerPeer?: string }>();
  vi.mocked(runtime.state.openBlobStore).mockReturnValue(blobStore as never);
  setA2aChannelRuntime(runtime);
  const controller = new AbortController();
  const account: ResolvedA2aChannelAccount = {
    accountId: "default",
    enabled: true,
    configured: true,
    config: { peers: { hermes: { token: "test-token" } } },
  };
  const statusPatchSink = vi.fn();
  const ctx = createStartAccountContext({
    account,
    abortSignal: controller.signal,
    statusPatchSink,
  });
  ctx.channelRuntime = runtime.channel;
  return { registry, runtime, blobStore, controller, account, statusPatchSink, ctx };
}

describe("A2A gateway account lifecycle", () => {
  it("registers exact plugin-owned routes and removes them when the account stops", async () => {
    const fixture = createA2aGatewayFixture();
    const lifecycle = startA2aGatewayAccount(fixture.ctx);
    // Routes open once persisted tasks are restored.
    await vi.waitFor(() => expect(fixture.registry.httpRoutes).toHaveLength(3));

    expect(fixture.registry.httpRoutes).toEqual(
      ["/.well-known/agent-card.json", "/.well-known/agent.json", "/a2a/v1"].map((path) =>
        expect.objectContaining({ path, auth: "plugin", match: "exact", pluginId: "a2a" }),
      ),
    );
    expect(fixture.ctx.getStatus()).toEqual(
      expect.objectContaining({ lifecycle: "ready", connected: true }),
    );

    fixture.controller.abort();
    await lifecycle;

    expect(fixture.registry.httpRoutes).toEqual([]);
    expect(fixture.ctx.getStatus()).toEqual(
      expect.objectContaining({ lifecycle: "stopped", running: false, connected: false }),
    );
  });

  it("rolls back already registered routes when a later route belongs to another plugin", async () => {
    const fixture = createA2aGatewayFixture();
    const releaseConflict = registerPluginHttpRoute({
      path: "/.well-known/agent.json",
      auth: "plugin",
      match: "exact",
      pluginId: "other-plugin",
      handler: () => true,
      throwOnFailure: true,
    });

    await expect(startA2aGatewayAccount(fixture.ctx)).rejects.toThrow(/other-plugin/);

    expect(fixture.registry.httpRoutes).toEqual([
      expect.objectContaining({
        path: "/.well-known/agent.json",
        pluginId: "other-plugin",
      }),
    ]);
    expect(fixture.ctx.getStatus()).toEqual(
      expect.objectContaining({ lifecycle: "stopped", running: false }),
    );
    releaseConflict();
  });

  it("fails closed without configured peers instead of exposing discovery routes", async () => {
    const fixture = createA2aGatewayFixture();
    fixture.account.configured = false;

    await expect(startA2aGatewayAccount(fixture.ctx)).rejects.toThrow(/not configured/);

    expect(fixture.registry.httpRoutes).toEqual([]);
  });

  it("restores persisted tasks from the plugin state store when the account starts", async () => {
    const fixture = createA2aGatewayFixture();
    const persistence = new A2aStateTaskPersistence(fixture.blobStore);
    const timestamp = "2026-10-04T10:00:00.000Z";
    await persistence.save({
      task: {
        id: "finished-task",
        contextId: "ctx-1",
        status: { state: "TASK_STATE_COMPLETED", timestamp },
        artifacts: [{ artifactId: "a1", parts: [{ text: "kept" }] }],
        history: [],
      },
      ownerPeer: "hermes",
      finishedAt: Date.now(),
    });
    await persistence.save({
      task: {
        id: "running-task",
        contextId: "ctx-1",
        status: { state: "TASK_STATE_WORKING", timestamp },
        artifacts: [],
        history: [],
      },
      ownerPeer: "hermes",
    });
    const lifecycle = startA2aGatewayAccount(fixture.ctx);
    await vi.waitFor(() => expect(fixture.registry.httpRoutes).toHaveLength(3));
    expect(fixture.runtime.state.openBlobStore).toHaveBeenCalledWith(A2A_TASK_BLOB_STORE_OPTIONS);

    const route = fixture.registry.httpRoutes.find((entry) => entry.path === "/a2a/v1")!;
    async function getTask(id: string) {
      const body = JSON.stringify({ jsonrpc: "2.0", id: "get", method: "GetTask", params: { id } });
      const request = createMockIncomingRequest([body]);
      request.method = "POST";
      request.url = "/a2a/v1";
      request.headers = {
        host: "gateway.example.test",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        authorization: "Bearer test-token",
      };
      const response = createMockServerResponse();
      await route.handler(request, response);
      return JSON.parse(response.body ?? "") as { result?: { status: unknown; artifacts: unknown } };
    }

    expect((await getTask("finished-task")).result).toMatchObject({
      status: { state: "TASK_STATE_COMPLETED" },
      artifacts: [{ parts: [{ text: "kept" }] }],
    });
    expect((await getTask("running-task")).result).toMatchObject({
      status: {
        state: "TASK_STATE_FAILED",
        message: { parts: [{ text: A2A_RESTART_INTERRUPTED_MESSAGE }] },
      },
    });

    fixture.controller.abort();
    await lifecycle;
    await expect(persistence.load("running-task", "hermes")).resolves.toMatchObject({
      task: { status: { state: "TASK_STATE_FAILED" } },
    });
  });
});
