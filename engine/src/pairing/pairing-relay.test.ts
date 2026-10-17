import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPairingRelaySession,
  decryptPairingFrame,
  encryptPairingFrame,
  listenPairingRelay,
  startPairingRelayHost,
} from "./pairing-relay.js";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (opened.length > 0) {
    await opened.pop()?.close();
  }
});

describe("pairing relay", () => {
  it("round-trips an end-to-end encrypted frame the relay never unwraps", () => {
    const key = Buffer.alloc(32, 7);
    const plain = Buffer.from("hello pairing");
    const envelope = encryptPairingFrame(key, plain);
    expect(envelope.subarray(12 + 16).equals(plain)).toBe(false);
    expect(decryptPairingFrame(key, envelope).equals(plain)).toBe(true);
  });

  it("pipes a phone through an outbound host session into a local gateway", async () => {
    const relay = await listenPairingRelay();
    opened.push(relay);

    const gatewayHttp = createServer();
    const gatewayWss = new WebSocketServer({ server: gatewayHttp });
    const fromPhone = new Promise<string>((resolve) => {
      gatewayWss.on("connection", (socket) => {
        socket.on("message", (data) => {
          socket.send(`ack:${String(data)}`);
          resolve(String(data));
        });
      });
    });
    gatewayHttp.listen(0, "127.0.0.1");
    await once(gatewayHttp, "listening");
    const gatewayPort = (gatewayHttp.address() as { port: number }).port;
    opened.push({
      close: async () => {
        gatewayWss.close();
        gatewayHttp.close();
        await once(gatewayHttp, "close").catch(() => undefined);
      },
    });

    const session = await createPairingRelaySession({ relayUrl: relay.baseUrl });
    const host = await startPairingRelayHost({
      relayWsUrl: session.wsUrl,
      localGatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
      hostToken: session.hostToken,
      key: session.key,
    });
    opened.push(host);

    const phone = new WebSocket(session.peerUrl);
    await once(phone, "open");
    phone.send(encryptPairingFrame(session.key, Buffer.from("pair-hello")));
    const replied = once(phone, "message").then(([data]) =>
      decryptPairingFrame(
        session.key,
        Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer),
      ).toString("utf8"),
    );
    await expect(fromPhone).resolves.toBe("pair-hello");
    await expect(replied).resolves.toBe("ack:pair-hello");
    phone.close();
  });

  it("rejects an unauthenticated join that only knows the session id", async () => {
    const relay = await listenPairingRelay();
    opened.push(relay);
    const session = await createPairingRelaySession({ relayUrl: relay.baseUrl });
    const bare = new WebSocket(session.wsUrl);
    const roleOnly = new WebSocket(`${session.wsUrl}?role=peer`);
    await once(bare, "close");
    await once(roleOnly, "close");
    expect(bare.readyState).toBe(WebSocket.CLOSED);
    expect(roleOnly.readyState).toBe(WebSocket.CLOSED);
  });

  it("does not put the bootstrap token on the relay hop", async () => {
    const relay = await listenPairingRelay();
    opened.push(relay);

    const gatewayHttp = createServer();
    const gatewayWss = new WebSocketServer({ server: gatewayHttp });
    gatewayWss.on("connection", (socket) => {
      socket.send(JSON.stringify({ bootstrapToken: "bootstrap-secret-token" }));
    });
    gatewayHttp.listen(0, "127.0.0.1");
    await once(gatewayHttp, "listening");
    const gatewayPort = (gatewayHttp.address() as { port: number }).port;
    opened.push({
      close: async () => {
        gatewayWss.close();
        gatewayHttp.close();
        await once(gatewayHttp, "close").catch(() => undefined);
      },
    });

    const session = await createPairingRelaySession({ relayUrl: relay.baseUrl });
    const host = await startPairingRelayHost({
      relayWsUrl: session.wsUrl,
      localGatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
      hostToken: session.hostToken,
      key: session.key,
    });
    opened.push(host);

    const phone = new WebSocket(session.peerUrl);
    const gotMessage = once(phone, "message");
    await once(phone, "open");
    const [data] = await gotMessage;
    const raw = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    expect(raw).not.toContain("bootstrap-secret-token");
    expect(() => JSON.parse(raw)).toThrow();
    phone.close();
  });
});
