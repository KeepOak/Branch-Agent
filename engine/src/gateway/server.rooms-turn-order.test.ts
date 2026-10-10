import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { writeOpenAiResponsesSse } from "../../test/helpers/openai-responses-sse.js";
import type { BranchConfig } from "../config/types.branch.js";
import { areHeartbeatsEnabled, setHeartbeatsEnabled } from "../infra/heartbeat-wake.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import type { Room, RoomEvent } from "./rooms/store.js";
import { disconnectGatewayClient, startGatewayWithClient } from "./test-helpers.e2e.js";
import { buildMockOpenAiResponsesProvider } from "./test-openai-responses-model.js";

it("completes every room Trunk in member order over a persistent scratch gateway connection", async () => {
  const state = await createBranchTestState({
    label: "room-turn-order",
    env: {
      BRANCH_TEST_MINIMAL_GATEWAY: undefined,
      BRANCH_SKIP_CHANNELS: "1",
      BRANCH_SKIP_GMAIL_WATCHER: "1",
      BRANCH_SKIP_CRON: "1",
      BRANCH_SKIP_CANVAS_HOST: "1",
      BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
      BRANCH_SKIP_PROVIDERS: "1",
      BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
      BRANCH_GATEWAY_TOKEN: undefined,
      BRANCH_GATEWAY_PASSWORD: undefined,
    },
  });
  const order = ["bo", "ada", "cy"];
  const requests: string[] = [];
  const providerServer = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      requests.push(Buffer.concat(chunks).toString("utf8"));
      const text = `Room reply ${requests.length}`;
      const item = {
        type: "message",
        id: `reply-${requests.length}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      };
      writeOpenAiResponsesSse(response, [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, content: [], status: "in_progress" },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          item_id: item.id,
          content_index: 0,
          delta: text,
        },
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: `response-${requests.length}`,
            status: "completed",
            output: [item],
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          },
        },
      ]);
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
  });
  let gateway: Awaited<ReturnType<typeof startGatewayWithClient>> | undefined;
  const heartbeatEnabled = areHeartbeatsEnabled();
  try {
    setHeartbeatsEnabled(false);
    await new Promise<void>((resolve, reject) => {
      providerServer.once("error", reject);
      providerServer.listen(0, "127.0.0.1", resolve);
    });
    const address = providerServer.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture did not bind");
    }
    // Local deterministic provider only; no subscription or external service is contacted.
    const provider = buildMockOpenAiResponsesProvider(`http://127.0.0.1:${address.port}/v1`);
    const cfg = {
      agents: {
        ownership: "explicit",
        entries: Object.fromEntries(order.map((id) => [id, { name: id }])),
        defaults: {
          workspace: state.workspaceDir,
          skipBootstrap: true,
          heartbeat: { every: "0m" },
          model: { primary: provider.modelRef },
          models: {
            [provider.modelRef]: {
              agentRuntime: { id: "branch" },
              params: { transport: "sse", openaiWsWarmup: false },
            },
          },
        },
      },
      models: {
        mode: "replace",
        providers: {
          [provider.providerId]: { ...provider.config, request: { allowPrivateNetwork: true } },
        },
      },
      plugins: { slots: { memory: "none" } },
      tools: { profile: "minimal" },
    } satisfies BranchConfig;
    gateway = await startGatewayWithClient({
      cfg,
      configPath: state.configPath,
      token: "room-order-test",
      scopes: ["operator.admin", "operator.read", "operator.write"],
    });
    const client = gateway.client;
    const { room } = await client.request<{ room: Room }>("rooms.create", {
      name: "Turn order proof",
      rule: "everyone",
      members: order.map((id) => ({ kind: "trunk", id, role: id === "ada" ? "lead" : "member" })),
    });
    await client.request("rooms.rule.set", {
      roomId: room.roomId,
      rule: "everyone",
      trunksTalk: false,
    });
    const sent = await client.request<{ runId: string; runStarted: boolean; event: RoomEvent }>(
      "rooms.send",
      { roomId: room.roomId, message: "Give one short reply without tools or mentions." },
    );
    expect(sent.runStarted).toBe(true);
    let turns: RoomEvent[] = [];
    await vi.waitFor(
      async () => {
        const log = await client.request<{ events: RoomEvent[] }>("rooms.log", {
          roomId: room.roomId,
        });
        turns = log.events.filter(
          (event) => event.seq > sent.event.seq && event.kind.startsWith("turn."),
        );
        expect(turns.map((event) => [event.kind, event.actorId])).toEqual(
          order.flatMap((id) => [
            ["turn.started", id],
            ["turn.replied", id],
          ]),
        );
      },
      { timeout: 30_000 },
    );
    expect(turns[0]?.payload).toMatchObject({ runId: sent.runId });
    for (let index = 0; index < order.length; index++) {
      const start = turns[index * 2]!.payload as { runId: string };
      expect(start.runId).toEqual(expect.any(String));
      expect(turns[index * 2 + 1]!.payload).toMatchObject({
        runId: start.runId,
        text: `Room reply ${index + 1}`,
      });
    }
    expect(requests).toHaveLength(3);
    expect(requests[1]).toContain("Room reply 1");
    expect(requests[2]).toContain("Room reply 1");
    expect(requests[2]).toContain("Room reply 2");
  } finally {
    try {
      if (gateway) {
        await disconnectGatewayClient(gateway.client);
        await gateway.server.close({ reason: "room turn-order test cleanup" });
      }
    } finally {
      providerServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        providerServer.close(() => resolve());
      });
      try {
        await state.cleanup();
      } finally {
        setHeartbeatsEnabled(heartbeatEnabled);
      }
    }
  }
}, 90_000);
