import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { safeEqualSecret } from "../security/secret-equal.js";

const AES_GCM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PAIRING_REMOTE_CLIENT_HEADER = "x-branch-pairing-remote";
const UNSPECIFIED_REMOTE = "0.0.0.0";

export type PairingRelaySession = {
  sessionId: string;
  wsUrl: string;
  peerUrl: string;
  hostToken: string;
  peerToken: string;
  key: Buffer;
  close: () => Promise<void>;
};

export type PairingRelayServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

type QueuedRelayFrame = {
  data: Buffer;
  isBinary: boolean;
};

type RelaySession = {
  host?: WebSocket;
  peer?: WebSocket;
  hostToken: string;
  peerToken: string;
  hostQueue: QueuedRelayFrame[];
  peerQueue: QueuedRelayFrame[];
};

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part))));
  }
  return Buffer.from(data);
}

function pipeClose(from: WebSocket, to: WebSocket): void {
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

function mintJoinToken(): string {
  return randomBytes(32).toString("base64url");
}

export function pairingRelayJoinUrl(
  wsUrl: string,
  role: "host" | "peer",
  token: string,
): string {
  const parsed = new URL(wsUrl);
  parsed.searchParams.set("role", role);
  parsed.searchParams.set("token", token);
  return parsed.toString();
}

/**
 * In-process pairing relay used by tests and as the reference for a hosted
 * KeepOak relay. Desktop and phone both connect outbound with a join token;
 * the relay pipes ciphertext and never sees the session key.
 */
export async function listenPairingRelay(host = "127.0.0.1"): Promise<PairingRelayServer> {
  const sessions = new Map<string, RelaySession>();
  const httpServer: Server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/sessions") {
      void readJsonBody(req).finally(() => {
        const sessionId = randomBytes(16).toString("hex");
        const hostToken = mintJoinToken();
        const peerToken = mintJoinToken();
        sessions.set(sessionId, { hostToken, peerToken, hostQueue: [], peerQueue: [] });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ sessionId, path: sessionPath(sessionId), hostToken, peerToken }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (socket, req) => {
    const match = /^\/v1\/pair\/([0-9a-f]+)/u.exec(req.url ?? "");
    const params = new URL(req.url ?? "/", "http://pairing.invalid").searchParams;
    const role = params.get("role");
    const token = params.get("token");
    const session = match ? sessions.get(match[1] ?? "") : undefined;
    const expectedToken = role === "host" ? session?.hostToken : role === "peer" ? session?.peerToken : undefined;
    if (!session || (role !== "host" && role !== "peer") || !safeEqualSecret(token, expectedToken)) {
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
    const otherOf = () => (role === "host" ? session.peer : session.host);
    const queue = role === "host" ? session.hostQueue : session.peerQueue;
    socket.on("message", (data, isBinary) => {
      const other = otherOf();
      if (other?.readyState === WebSocket.OPEN) {
        other.send(data, { binary: isBinary });
        return;
      }
      queue.push({ data: asBuffer(data), isBinary });
    });
    const other = otherOf();
    if (session.host && session.peer && other) {
      pipeClose(socket, other);
      pipeClose(other, socket);
      const flush = (frames: QueuedRelayFrame[], target: WebSocket) => {
        while (frames.length > 0 && target.readyState === WebSocket.OPEN) {
          const next = frames.shift();
          if (next) {
            target.send(next.data, { binary: next.isBinary });
          }
        }
      };
      flush(session.hostQueue, session.peer);
      flush(session.peerQueue, session.host);
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
}): Promise<Omit<PairingRelaySession, "close">> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL("/v1/sessions", params.relayUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error("Pairing relay did not accept a new session.");
  }
  const body = (await response.json()) as {
    sessionId?: unknown;
    hostToken?: unknown;
    peerToken?: unknown;
  };
  if (typeof body.sessionId !== "string" || !/^[0-9a-f]{32}$/u.test(body.sessionId)) {
    throw new Error("Pairing relay returned an invalid session.");
  }
  if (
    typeof body.hostToken !== "string" ||
    typeof body.peerToken !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(body.hostToken) ||
    !/^[A-Za-z0-9_-]+$/u.test(body.peerToken)
  ) {
    throw new Error("Pairing relay returned an invalid session.");
  }
  const wsUrl = pairingRelayWsUrl(params.relayUrl, body.sessionId);
  return {
    sessionId: body.sessionId,
    wsUrl,
    peerUrl: pairingRelayJoinUrl(wsUrl, "peer", body.peerToken),
    hostToken: body.hostToken,
    peerToken: body.peerToken,
    key: randomBytes(32),
  };
}

function waitOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const fail = () => {
      socket.close();
      reject(new Error("Pairing relay socket failed."));
    };
    socket.once("open", () => resolve());
    socket.once("error", fail);
  });
}

function sendWhenOpen(socket: WebSocket, payload: Buffer): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
    return;
  }
  const queued: Buffer[] = [payload];
  const flush = () => {
    socket.off("open", flush);
    while (queued.length > 0 && socket.readyState === WebSocket.OPEN) {
      const next = queued.shift();
      if (next) {
        socket.send(next);
      }
    }
  };
  socket.on("open", flush);
}

function pipeEncryptedRelayHop(relay: WebSocket, local: WebSocket, key: Buffer): void {
  relay.on("message", (data) => {
    try {
      sendWhenOpen(local, decryptPairingFrame(key, asBuffer(data)));
    } catch {
      relay.close();
      local.close();
    }
  });
  local.on("message", (data) => {
    try {
      sendWhenOpen(relay, encryptPairingFrame(key, asBuffer(data)));
    } catch {
      relay.close();
      local.close();
    }
  });
  pipeClose(relay, local);
  pipeClose(local, relay);
}

/** Desktop side: outbound WebSocket to the relay, piped to the local Gateway. */
export async function startPairingRelayHost(params: {
  relayWsUrl: string;
  localGatewayUrl: string;
  hostToken: string;
  key: Buffer;
}): Promise<{ close: () => Promise<void> }> {
  const host = new WebSocket(pairingRelayJoinUrl(params.relayWsUrl, "host", params.hostToken));
  const local = new WebSocket(params.localGatewayUrl, {
    headers: { [PAIRING_REMOTE_CLIENT_HEADER]: UNSPECIFIED_REMOTE },
  });
  pipeEncryptedRelayHop(host, local, params.key);
  try {
    await Promise.all([waitOpen(host), waitOpen(local)]);
    return {
      close: async () => {
        host.close();
        local.close();
      },
    };
  } catch (error) {
    host.close();
    local.close();
    throw error;
  }
}
