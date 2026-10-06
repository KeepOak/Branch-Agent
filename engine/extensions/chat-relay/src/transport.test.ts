import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { relayChannelConfigSchema } from "./config-schema.js";
import { RelayTransport, relayDialUrl } from "./transport.js";

const descriptor = (platform: string) => ({
  contract_version: 1, platform, label: platform, max_message_length: 4096,
  supports_draft_streaming: false, supports_edit: true, supports_threads: true,
  markdown_dialect: "plain", len_unit: "chars",
});

const closing: Array<() => Promise<void>> = [];

async function stubConnector() {
  const server = createServer();
  const sockets = new WebSocketServer({ server, path: "/relay" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing stub port");
  const frames: Record<string, unknown>[] = [];
  let connected!: WebSocket;
  const connection = new Promise<WebSocket>((resolve) => {
    sockets.on("connection", (socket) => {
      connected = socket;
      socket.on("message", (data) => {
        const frame = JSON.parse(String(data)) as Record<string, unknown>;
        frames.push(frame);
        if (frame.type === "hello") {
          socket.send(JSON.stringify({ type: "descriptor", descriptor: descriptor(String(frame.platform)) }));
        }
        if (frame.type === "outbound") {
          socket.send(JSON.stringify({ type: "outbound_result", requestId: frame.requestId, result: { success: true, message_id: "msg-42" } }));
        }
      });
      resolve(socket);
    });
  });
  closing.push(async () => {
    connected?.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${address.port}`, frames, connection };
}

afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

describe("Hermes relay WebSocket contract", () => {
  it("normalizes HTTP connector base URLs to the relay dial path", () => {
    expect(relayDialUrl("https://relay.example/base/")).toBe("wss://relay.example/base/relay");
    expect(relayDialUrl("wss://relay.example/relay")).toBe("wss://relay.example/relay");
    expect(relayDialUrl("ws://127.0.0.1/relay")).toBe("ws://127.0.0.1/relay");
  });

  it.each(["http://relay.example", "ws://relay.example", "ftp://relay.example"])(
    "rejects insecure or unsupported remote URL %s in config and at dial time",
    (url) => {
      expect(relayChannelConfigSchema.runtime?.safeParse({ url }).success).toBe(false);
      expect(() => relayDialUrl(url)).toThrow();
    },
  );

  it.each(["http://127.0.0.1:1234", "ws://localhost:1234", "http://[::1]:1234"])(
    "allows loopback URL %s",
    (url) => {
      expect(relayChannelConfigSchema.runtime?.safeParse({ url }).success).toBe(true);
      expect(relayDialUrl(url)).toMatch(/\/relay$/u);
    },
  );

  it("sends one hello per identity and tags outbound with its platform and bot id", async () => {
    const stub = await stubConnector();
    const transport = new RelayTransport({
      url: stub.url,
      identities: [{ platform: "discord", botId: "app-1" }, { platform: "telegram", botId: "bot-9" }],
      onInbound: async () => {},
    });
    try {
      await transport.connect();
      await stub.connection;
      const result = await transport.sendOutbound({ op: "send", chat_id: "chan-1", content: "hello" }, "telegram");
      expect(result).toMatchObject({ success: true, message_id: "msg-42" });
      expect(stub.frames.filter((frame) => frame.type === "hello")).toEqual([
        { type: "hello", platform: "discord", botId: "app-1" },
        { type: "hello", platform: "telegram", botId: "bot-9" },
      ]);
      expect(stub.frames.find((frame) => frame.type === "outbound")).toMatchObject({ platform: "telegram", botId: "bot-9" });
    } finally {
      await transport.close();
    }
  });

  it("ACKs a buffered inbound event only after its handler resolves", async () => {
    const stub = await stubConnector();
    let release!: () => void;
    const handled = new Promise<void>((resolve) => { release = resolve; });
    const transport = new RelayTransport({
      url: stub.url,
      identities: [{ platform: "discord", botId: "app-1" }],
      onInbound: async () => { await handled; },
    });
    try {
      await transport.connect();
      const socket = await stub.connection;
      socket.send(JSON.stringify({ type: "inbound", bufferId: "buf-1", event: { text: "hello", message_id: "m1", source: { platform: "discord", chat_id: "c1", user_id: "u1" } } }));
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(stub.frames.some((frame) => frame.type === "inbound_ack")).toBe(false);
      release();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(stub.frames.at(-1)).toEqual({ type: "inbound_ack", bufferId: "buf-1" });
    } finally {
      release();
      await transport.close();
    }
  });

  it("resolves the closed signal when a connector disconnects", async () => {
    const stub = await stubConnector();
    const transport = new RelayTransport({
      url: stub.url,
      identities: [{ platform: "discord", botId: "app-1" }],
      onInbound: async () => {},
    });
    await transport.connect();
    const socket = await stub.connection;
    socket.close();
    await expect(transport.waitUntilClosed()).resolves.toBeUndefined();
  });
});
