// Gateway half of hermes-agent gateway/relay/ws_transport.py's v1 JSON WebSocket contract.
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { parseRelayDescriptor, type RelayDescriptor } from "./descriptor.js";

export type RelayIdentity = { platform: string; botId: string };
export type RelayInboundEvent = {
  text?: string;
  message_id?: string;
  reply_to_message_id?: string;
  source?: {
    platform?: string;
    chat_id?: string;
    chat_type?: string;
    chat_name?: string;
    user_id?: string;
    user_name?: string;
    user_display_name?: string;
    scope_id?: string;
    thread_id?: string;
    message_id?: string;
  };
};

export function isAllowedRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "wss:") return true;
    return (url.protocol === "http:" || url.protocol === "ws:") &&
      (url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname.startsWith("127."));
  } catch {
    return false;
  }
}

export function relayDialUrl(url: string): string {
  if (!isAllowedRelayUrl(url)) {
    throw new Error("Chat relay URL requires HTTPS or WSS unless connecting to loopback");
  }
  const base = url.trim().replace(/\/+$/u, "").replace(/^https:/u, "wss:").replace(/^http:/u, "ws:");
  return base.endsWith("/relay") ? base : `${base}/relay`;
}

export class RelayTransport {
  private socket?: WebSocket;
  private closed = false;
  private descriptors = new Map<string, RelayDescriptor>();
  private pending = new Map<string, { resolve: (result: Record<string, unknown>) => void; timer: NodeJS.Timeout }>();
  private inboundQueue = Promise.resolve();
  private handshake?: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private resolveClosed!: () => void;
  private readonly closedSignal = new Promise<void>((resolve) => { this.resolveClosed = resolve; });

  constructor(private readonly options: {
    url: string;
    identities: readonly RelayIdentity[];
    authorization?: string;
    onInbound: (event: RelayInboundEvent) => Promise<void>;
    onError?: (error: Error) => void;
  }) {}

  descriptorFor(platform: string): RelayDescriptor | undefined {
    return this.descriptors.get(platform);
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(relayDialUrl(this.options.url), {
      ...(this.options.authorization ? { headers: { Authorization: `Bearer ${this.options.authorization}` } } : {}),
      handshakeTimeout: 30_000,
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshake = undefined;
        socket.close();
        reject(new Error("Relay handshake timed out"));
      }, 30_000);
      this.handshake = { resolve, reject, timer };
      socket.once("open", () => {
        for (const identity of this.options.identities) {
          socket.send(JSON.stringify({ type: "hello", platform: identity.platform, botId: identity.botId }));
        }
      });
      socket.on("message", (data) => this.acceptFrame(String(data)));
      socket.on("error", (error) => {
        this.fail(error);
        this.options.onError?.(error);
      });
      socket.on("close", () => {
        this.fail(new Error("Relay connection closed"));
        this.resolveClosed();
      });
    });
  }

  async sendOutbound(action: Record<string, unknown>, platform: string): Promise<Record<string, unknown>> {
    const identity = this.options.identities.find((item) => item.platform === platform);
    if (!identity) {
      throw new Error(`Relay does not front platform ${platform}`);
    }
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Relay transport not connected");
    }
    const requestId = randomUUID().replace(/-/gu, "");
    return await new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ success: false, error: "relay outbound timed out", ambiguous: true });
      }, 30_000);
      this.pending.set(requestId, { resolve, timer });
      this.socket?.send(JSON.stringify({ type: "outbound", requestId, action, platform, ...(identity.botId ? { botId: identity.botId } : {}) }), (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve({ success: false, error: error.message, ambiguous: true });
        }
      });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.socket?.close();
    this.fail(new Error("Relay transport closed"));
    await this.inboundQueue;
  }

  async waitUntilClosed(): Promise<void> {
    await this.closedSignal;
    await this.inboundQueue;
  }

  private acceptFrame(line: string): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (frame.type === "descriptor") {
      try {
        const descriptor = parseRelayDescriptor(frame.descriptor);
        this.descriptors.set(descriptor.platform, descriptor);
        // Hermes completes the handshake on the first descriptor; later ones
        // enrich per-platform capabilities without holding the gateway offline.
        if (this.handshake) {
          this.handshake?.resolve();
          if (this.handshake) clearTimeout(this.handshake.timer);
          this.handshake = undefined;
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    } else if (frame.type === "outbound_result") {
      const requestId = String(frame.requestId ?? "");
      const request = this.pending.get(requestId);
      if (request) {
        clearTimeout(request.timer);
        this.pending.delete(requestId);
        request.resolve(frame.result && typeof frame.result === "object" ? frame.result as Record<string, unknown> : {});
      }
    } else if (frame.type === "inbound") {
      const event = frame.event as RelayInboundEvent;
      if (!event || typeof event !== "object") return;
      this.inboundQueue = this.inboundQueue.then(async () => {
        await this.options.onInbound(event);
        if (frame.bufferId && this.socket?.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ type: "inbound_ack", bufferId: String(frame.bufferId) }));
        }
      }).catch((error: unknown) => {
        // Do not ACK failed dispatch; reconnect lets the connector replay it.
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
        this.socket?.close();
      });
    }
  }

  private fail(error: Error): void {
    if (this.handshake) {
      clearTimeout(this.handshake.timer);
      this.handshake.reject(error);
      this.handshake = undefined;
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.resolve({ success: false, error: error.message, ambiguous: true });
    }
    this.pending.clear();
  }
}
