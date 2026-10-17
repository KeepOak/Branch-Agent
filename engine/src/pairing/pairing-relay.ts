import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

const AES_GCM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type PairingRelaySession = {
  sessionId: string;
  wsUrl: string;
  key: Buffer;
  close: () => Promise<void>;
};

export type PairingRelayServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

function pipeSockets(left: WebSocket, right: WebSocket): void {
  const send = (from: WebSocket, to: WebSocket) => {
    from.on("message", (data, isBinary) => {
      if (to.readyState === WebSocket.OPEN) {
        to.send(data, { binary: isBinary });
      }
    });
    from.on("close", () => {
      if (to.readyState === WebSocket.OPEN || to.readyState === WebSocket.CONNECTING) {
        to.close();
      }
    });
    from.on("error", () => {
      if (to.readyState === WebSocket.OPEN || to.readyState === WebSocket.CONNECTING) {
        to.close();
      }
    });
  };
  send(left, right);
  send(right, left);
}

/** AES-256-GCM envelope the phone and desktop share; the relay only forwards bytes. */
export function encryptPairingFrame(key: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(AES_GCM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

export function decryptPairingFrame(key: Buffer, envelope: Buffer): Buffer {
  if (envelope.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("Pairing relay frame is too short.");
  }
  const nonce = envelope.subarray(0, NONCE_BYTES);
  const tag = envelope.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(AES_GCM, key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sessionPath(sessionId: string): string {
  return `/v1/pair/${sessionId}`;
}

function readJsonBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * In-process pairing relay used by tests and as the reference for a hosted
 * KeepOak relay. Desktop and phone both connect outbound; the relay pipes
 * ciphertext and never sees the session key.
 */
export async function listenPairingRelay(host = "127.0.0.1"): Promise<PairingRelayServer> {
  const sessions = new Map<string, { host?: WebSocket; peer?: WebSocket }>();
  const httpServer: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/sessions") {
      void readJsonBody(req).finally(() => {
        const sessionId = randomBytes(16).toString("hex");
        sessions.set(sessionId, {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId, path: sessionPath(sessionId) }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (socket, req) => {
    const match = /^\/v1\/pair\/([0-9a-f]+)/u.exec(req.url ?? "");
    const role = new URL(req.url ?? "/", "http://pairing.invalid").searchParams.get("role");
    const session = match ? sessions.get(match[1] ?? "") : undefined;
    if (!session || (role !== "host" && role !== "peer")) {
      socket.close();
      return;
    }
    if (role === "host") {
      if (session.host) {
        socket.close();
        return;
      }
      session.host = socket;
    } else {
      if (session.peer) {
        socket.close();
        return;
      }
      session.peer = socket;
    }
    if (session.host && session.peer) {
      pipeSockets(session.host, session.peer);
    }
    socket.on("close", () => {
      if (role === "host") {
        session.host = undefined;
      } else {
        session.peer = undefined;
      }
    });
  });
  httpServer.listen(0, host);
  await once(httpServer, "listening");
  const address = httpServer.address() as AddressInfo;
  return {
    baseUrl: `http://${host}:${address.port}`,
    close: async () => {
      for (const socket of wss.clients) {
        socket.close();
      }
      wss.close();
      httpServer.close();
      await once(httpServer, "close").catch(() => undefined);
    },
  };
}

export function pairingRelayWsUrl(baseUrl: string, sessionId: string): string {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = sessionPath(sessionId);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export async function createPairingRelaySession(params: {
  relayUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<Omit<PairingRelaySession, "close" | "key"> & { key: Buffer }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/v1/sessions", params.relayUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error("Pairing relay did not accept a new session.");
  }
  const body = (await response.json()) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string" || !/^[0-9a-f]{32}$/u.test(body.sessionId)) {
    throw new Error("Pairing relay returned an invalid session.");
  }
  return {
    sessionId: body.sessionId,
    wsUrl: pairingRelayWsUrl(params.relayUrl, body.sessionId),
    key: randomBytes(32),
  };
}

function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      socket.close();
      reject(error);
    };
    socket.once("open", () => resolve(socket));
    socket.once("error", () => fail(new Error("Pairing relay socket failed.")));
  });
}

/** Desktop side: outbound WebSocket to the relay, piped to the local Gateway. */
export async function startPairingRelayHost(params: {
  relayWsUrl: string;
  localGatewayUrl: string;
}): Promise<{ close: () => Promise<void> }> {
  const host = await openSocket(`${params.relayWsUrl}?role=host`);
  try {
    const local = await openSocket(params.localGatewayUrl);
    pipeSockets(host, local);
    return {
      close: async () => {
        host.close();
        local.close();
      },
    };
  } catch (error) {
    host.close();
    throw error;
  }
}
