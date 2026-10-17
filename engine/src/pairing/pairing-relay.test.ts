import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { loadPhoneGateway } from "./load-phone-gateway.js";
import {
  createPairingRelaySession,
  decryptPairingFrame,
  encryptPairingFrame,
  listenPairingRelay,
  pairingRelayJoinUrl,
  startPairingRelayHost,
} from "./pairing-relay.js";

function waitClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return once(socket, "close").then(() => undefined);
}

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
    await Promise.all([waitClosed(bare), waitClosed(roleOnly)]);
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

  it("does not put a phone bootstrap token on the relay hop", async () => {
    const PhoneGateway = await loadPhoneGateway();
    const relay = await listenPairingRelay();
    opened.push(relay);

    const gatewayHttp = createServer();
    const gatewayWss = new WebSocketServer({ server: gatewayHttp });
    const fromPhone = new Promise<string>((resolve) => {
      gatewayWss.on("connection", (socket) => {
        socket.send(
          JSON.stringify({
            type: "event",
            event: "connect.challenge",
            payload: { nonce: "nonce-1", ts: 1_800_000_000_001 },
          }),
        );
        socket.on("message", (data) => resolve(String(data)));
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
    const host = new WebSocket(pairingRelayJoinUrl(session.wsUrl, "host", session.hostToken));
    const local = new WebSocket(`ws://127.0.0.1:${gatewayPort}`, {
      headers: { "x-branch-pairing-remote": "0.0.0.0" },
    });
    opened.push({
      close: async () => {
        host.close();
        local.close();
      },
    });
    const sendWhenOpen = (socket: WebSocket, payload: Buffer) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
        return;
      }
      socket.once("open", () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(payload);
        }
      });
    };
    const rawFromPhone: Buffer[] = [];
    local.on("message", (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      sendWhenOpen(host, encryptPairingFrame(session.key, buf));
    });
    host.on("message", (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      rawFromPhone.push(buf);
      sendWhenOpen(local, decryptPairingFrame(session.key, buf));
    });
    await Promise.all([once(host, "open"), once(local, "open")]);

    const token = "phone-bootstrap-token";
    const phone = new PhoneGateway({
      url: session.peerUrl,
      platform: "ios",
      appVersion: "0.1.0",
      bootstrapToken: token,
      relayKey: session.key.toString("base64url"),
      randomBytes: (count) => new Uint8Array(randomBytes(count)),
      loadIdentity: async () => ({
        deviceId: "ab".repeat(32),
        publicKey: "dGVzdC1wdWJrZXk",
        sign: async () => "dGVzdC1zaWc",
      }),
      tokenStore: { load: () => null, store: () => undefined, clear: () => undefined },
      createRequestId: () => "req-1",
      createSocket: (url, handlers) => {
        const socket = new WebSocket(url);
        socket.on("open", () => handlers.open());
        socket.on("message", (data) => handlers.message(data));
        socket.on("close", (code, reason) => handlers.close(code, String(reason)));
        socket.on("error", (error) => handlers.error(error instanceof Error ? error : new Error("websocket error")));
        return {
          isOpen: () => socket.readyState === WebSocket.OPEN,
          send: (data) => socket.send(data),
          close: (code, reason) => socket.close(code, reason),
        };
      },
      onStatus: (status) => {
        if (status && typeof status === "object" && "phase" in status && status.phase === "failed") {
          throw new Error(`phone gateway failed: ${JSON.stringify(status)}`);
        }
      },
    });
    opened.push({ close: async () => phone.stop() });
    phone.start();
    const plaintext = await fromPhone;
    expect(plaintext).toContain(token);
    expect(rawFromPhone.length).toBeGreaterThan(0);
    const hop = rawFromPhone.map((buf) => buf.toString("utf8")).join("");
    expect(hop).not.toContain(token);
    expect(
      rawFromPhone.some((raw) => {
        try {
          JSON.parse(raw.toString("utf8"));
          return true;
        } catch {
          return false;
        }
      }),
    ).toBe(false);
    expect(decryptPairingFrame(session.key, rawFromPhone[0]!).toString("utf8")).toContain(token);
  });
});
