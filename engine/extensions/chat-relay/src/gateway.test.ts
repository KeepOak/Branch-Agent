import { createServer } from "node:http";
import type { ChannelGatewayContext } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { resolveRelayAccount } from "./accounts.js";
import { activeRelayTransports, startRelayGatewayAccount } from "./gateway.js";
import { handleRelayInbound } from "./inbound.js";
import { sendRelayText } from "./outbound.js";

vi.mock("./inbound.js", () => ({ handleRelayInbound: vi.fn(async () => {}) }));

const closing: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closing.splice(0)) await close(); });

it("routes an authenticated inbound scope back through a real relay WebSocket", async () => {
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: "/relay" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("stub address unavailable");
  let peer!: WebSocket;
  const outbound = new Promise<Record<string, unknown>>((resolve) => {
    sockets.on("connection", (socket) => {
      peer = socket;
      socket.on("message", (data) => {
        const frame = JSON.parse(String(data)) as Record<string, unknown>;
        if (frame.type === "hello") {
          socket.send(JSON.stringify({
            type: "descriptor",
            descriptor: { contract_version: 1, platform: "discord", label: "Discord", max_message_length: 2000, len_unit: "utf16" },
          }));
          socket.send(JSON.stringify({
            type: "inbound", bufferId: "b1",
            event: { text: "hello", message_id: "m1", source: { platform: "discord", chat_id: "dm-1", chat_type: "dm", user_id: "user-42", scope_id: "scope-9" } },
          }));
        } else if (frame.type === "outbound") {
          resolve(frame);
          socket.send(JSON.stringify({ type: "outbound_result", requestId: frame.requestId, result: { success: true, message_id: "m2" } }));
        }
      });
    });
  });
  closing.push(async () => {
    peer?.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const cfg = {
    channels: { "chat-relay": { enabled: true, url: `http://127.0.0.1:${address.port}`, platform: "discord", botId: "app-1" } },
  } as BranchConfig;
  const account = resolveRelayAccount({ cfg });
  const controller = new AbortController();
  const ctx = {
    cfg, account, accountId: account.accountId,
    abortSignal: controller.signal,
    channelRuntime: {},
    getStatus: () => ({}), setStatus: vi.fn(), log: { info: vi.fn(), warn: vi.fn() },
  } as unknown as ChannelGatewayContext<typeof account>;
  const running = startRelayGatewayAccount(ctx);
  try {
    await vi.waitFor(() => expect(handleRelayInbound).toHaveBeenCalledTimes(1));
    expect(activeRelayTransports.has(account.accountId)).toBe(true);
    const messageId = await sendRelayText({ cfg, to: "discord:direct:dm-1", text: "reply", replyToId: "m1" });
    expect(messageId).toBe("m2");
    expect(await outbound).toMatchObject({
      platform: "discord", botId: "app-1",
      action: { op: "send", chat_id: "dm-1", content: "reply", metadata: { scope_id: "scope-9", user_id: "user-42" } },
    });
  } finally {
    controller.abort();
    await running;
  }
});
