import { once } from "node:events";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { PROTOCOL_VERSION } from "../../packages/gateway-protocol/src/version.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  captureActivePluginRegistrySnapshot,
  restoreActivePluginRegistrySnapshot,
  stageActivePluginRegistry,
} from "../plugins/runtime.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { acquireTestPortBlock } from "../test-utils/port-claims.js";
import { prepareGatewayKernel } from "./server-kernel.js";
import type { GatewayServer } from "./server-public.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { startClaimedGateway } from "./test-helpers.listener.js";

describe("Gateway startup node capabilities", () => {
  it("reconnects affected nodes when plugins attach after their handshake", async () => {
    const state = await createBranchTestState({
      label: "gateway-startup-node-capabilities",
      layout: "home",
      env: {
        BRANCH_GATEWAY_PASSWORD: undefined,
        BRANCH_GATEWAY_TOKEN: undefined,
        BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
        BRANCH_SKIP_CANVAS_HOST: "1",
        BRANCH_SKIP_CHANNELS: "1",
        BRANCH_SKIP_CRON: "1",
        BRANCH_SKIP_GMAIL_WATCHER: "1",
        BRANCH_SKIP_PROVIDERS: "1",
        BRANCH_TEST_MINIMAL_GATEWAY: "0",
        VITEST: "1",
      },
    });
    const previousRegistry = captureActivePluginRegistrySnapshot();
    const registry = createEmptyPluginRegistry();
    registry.httpRoutes.push({
      pluginId: "files",
      path: "/files",
      match: "prefix",
      auth: "gateway",
      nodeCapability: { surface: "files" },
      handler: async () => true,
    });
    const peerServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    const peerSockets: WebSocket[] = [];
    onTestFinished(async () => {
      for (const socket of [...peerSockets, ...peerServer.clients]) {
        socket.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        peerServer.close((error) => (error ? reject(error) : resolve()));
      });
    });
    await once(peerServer, "listening");
    const address = peerServer.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a loopback WebSocket listener");
    }
    const connectPeer = async (name: string, role: "node" | "operator", caps: string[]) => {
      const accepted = new Promise<WebSocket>((resolve) => {
        peerServer.once("connection", (socket) => resolve(socket));
      });
      const peer = new WebSocket(`ws://127.0.0.1:${address.port}`);
      peerSockets.push(peer);
      const closed = new Promise<{ code: number; reason: string }>((resolve) => {
        peer.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      });
      await once(peer, "open");
      const socket = await accepted;
      const client: GatewayWsClient = {
        socket,
        connId: name,
        usesSharedGatewayAuth: false,
        connect: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: { id: "branch-macos", version: "test", platform: "darwin", mode: "node" },
          role,
          ...(role === "operator" ? { scopes: ["operator.read"] } : {}),
          caps,
        },
        pluginNodeCapabilitySurfaces: {},
      };
      return { client, closed, peer };
    };
    const affected = await connectPeer("affected", "node", ["files"]);
    const unaffected = await connectPeer("unaffected", "node", ["camera"]);
    const operator = await connectPeer("operator", "operator", ["files"]);
    const pluginChanged = new Promise<{ event?: string; payload?: { generation?: number } }>(
      (resolve) => {
        operator.peer.on("message", (data) => {
          const frame = JSON.parse(data.toString()) as {
            event?: string;
            payload?: { generation?: number };
          };
          if (frame.event === "plugins.changed") resolve(frame);
        });
      },
    );
    const peers = [affected, unaffected, operator];
    let kernel: Awaited<ReturnType<Awaited<ReturnType<typeof prepareGatewayKernel>>["activate"]>> | undefined;
    let server: GatewayServer | undefined;
    const prepareKernel = prepareGatewayKernel;
    const factory = vi
      .spyOn(await import("./server-kernel.js"), "prepareGatewayKernel")
      .mockImplementation(async (...args) => {
        const prepared = await prepareKernel(...args);
        return {
          ...prepared,
          activate: async (...activateArgs) => {
            kernel = await prepared.activate(...activateArgs);
            for (const { client } of peers) {
              kernel.clients.add(client);
            }
            return kernel;
          },
        };
      });
    const postAttach = vi
      .spyOn(await import("./server-startup-post-attach.js"), "startGatewayPostAttachRuntime")
      .mockImplementation(async (params) => {
        await params.onStartupPluginsLoaded?.({ pluginRegistry: registry, gatewayMethods: [] });
        return { stopGatewayUpdateCheck: async () => {}, startupSettled: Promise.resolve() };
      });
    try {
      const token = "startup-node-capability-token";
      const claim = await acquireTestPortBlock({ offsets: [0] });
      server = await startClaimedGateway(claim, async () => {
        await state.writeConfig({
          gateway: {
            auth: { mode: "token", token },
            controlUi: { enabled: false },
            port: claim.port,
          },
        });
        state.applyEnv();
        stageActivePluginRegistry(createEmptyPluginRegistry(), null, "default");
        const { startGatewayServerCore } = await import("./server-start.js");
        return await startGatewayServerCore(claim.port, {
          auth: { mode: "token", token },
          bind: "loopback",
          controlUiEnabled: false,
          sidecarStartup: "defer",
        });
      });
      expect(affected.client.invalidated).toBe(true);
      await expect(affected.closed).resolves.toEqual({
        code: 1012,
        reason: "node capabilities changed",
      });
      expect(unaffected.client.socket.readyState).toBe(WebSocket.OPEN);
      expect(operator.client.socket.readyState).toBe(WebSocket.OPEN);
      await expect(pluginChanged).resolves.toMatchObject({
        event: "plugins.changed",
        payload: { generation: expect.any(Number) },
      });
    } finally {
      kernel?.clients.clear();
      try {
        await server?.close();
      } finally {
        factory.mockRestore();
        postAttach.mockRestore();
        restoreActivePluginRegistrySnapshot(previousRegistry);
        await state.cleanup();
      }
    }
  }, 240_000);
});
