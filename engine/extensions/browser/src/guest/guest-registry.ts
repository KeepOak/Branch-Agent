/**
 * Live guest browser panes, keyed by conversation session. The window declares
 * readiness over the gateway. The browser tool sends one operation at a time to
 * the pane and waits for the answer, bounded by a timeout and by the connection
 * that owns the pane.
 */
import { randomUUID } from "node:crypto";
import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";

export const GUEST_REQUEST_EVENT = "browser.guest.request";
export const GUEST_REQUEST_TIMEOUT_MS = 30_000;
export const NO_GUEST_REQUEST_ANSWER = "No request is waiting for that answer.";

export type GuestOp = "tabs" | "navigate" | "read" | "act" | "screenshot";
export type GuestAnswer = { ok: true; result: unknown } | { ok: false; error: string };
export type GuestOutcome =
  | { kind: "answered"; answer: GuestAnswer }
  | { kind: "timeout" }
  | { kind: "unavailable" }
  | { kind: "aborted" };
export type GuestRespondResult = { ok: true } | { ok: false; error: string };

export type GuestHostConnection = {
  connId: string;
  send: (event: string, payload: unknown) => void;
  closed?: AbortSignal;
};

export type GuestRequestInput = {
  sessionKey: string;
  op: GuestOp;
  args: Record<string, unknown>;
  signal?: AbortSignal;
};

export type GuestRegistry = {
  isReady(sessionKey: string): boolean;
  setReady(sessionKey: string, ready: boolean, host: GuestHostConnection): void;
  clearConnection(connId: string): void;
  request(input: GuestRequestInput): Promise<GuestOutcome>;
  respond(input: { requestId: string; connId: string; answer: GuestAnswer }): GuestRespondResult;
};

export type GuestRegistryOptions = {
  timeoutMs?: number;
  createRequestId?: () => string;
};

type PendingRequest = { connId: string; settle: (outcome: GuestOutcome) => void };

class GuestRegistryImpl implements GuestRegistry {
  private readonly hosts = new Map<string, GuestHostConnection>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly createRequestId: () => string;

  constructor(options: GuestRegistryOptions) {
    this.timeoutMs = options.timeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    this.createRequestId = options.createRequestId ?? randomUUID;
  }

  isReady(sessionKey: string): boolean {
    return this.hosts.has(sessionKey);
  }

  setReady(sessionKey: string, ready: boolean, host: GuestHostConnection): void {
    if (!ready) {
      // Only the connection that declared ready may clear it.
      if (this.hosts.get(sessionKey)?.connId === host.connId) {
        this.hosts.delete(sessionKey);
      }
      return;
    }
    if (host.closed?.aborted) {
      return;
    }
    this.hosts.set(sessionKey, host);
    host.closed?.addEventListener("abort", () => this.clearConnection(host.connId), {
      once: true,
    });
  }

  clearConnection(connId: string): void {
    for (const [sessionKey, host] of this.hosts) {
      if (host.connId === connId) {
        this.hosts.delete(sessionKey);
      }
    }
    for (const [requestId, entry] of this.pending) {
      if (entry.connId === connId) {
        this.finish(requestId, { kind: "unavailable" });
      }
    }
  }

  request(input: GuestRequestInput): Promise<GuestOutcome> {
    if (input.signal?.aborted) {
      return Promise.resolve({ kind: "aborted" });
    }
    const host = this.hosts.get(input.sessionKey);
    if (!host) {
      return Promise.resolve({ kind: "unavailable" });
    }
    return new Promise<GuestOutcome>((resolve) => {
      const requestId = this.createRequestId();
      this.track(requestId, host.connId, input.signal, resolve);
      try {
        host.send(GUEST_REQUEST_EVENT, {
          requestId,
          sessionKey: input.sessionKey,
          op: input.op,
          args: input.args,
        });
      } catch {
        this.finish(requestId, { kind: "unavailable" });
      }
    });
  }

  respond(input: { requestId: string; connId: string; answer: GuestAnswer }): GuestRespondResult {
    const entry = this.pending.get(input.requestId);
    if (!entry || entry.connId !== input.connId) {
      return { ok: false, error: NO_GUEST_REQUEST_ANSWER };
    }
    this.finish(input.requestId, { kind: "answered", answer: input.answer });
    return { ok: true };
  }

  private track(
    requestId: string,
    connId: string,
    signal: AbortSignal | undefined,
    resolve: (outcome: GuestOutcome) => void,
  ): void {
    const timer = setTimeout(() => this.finish(requestId, { kind: "timeout" }), this.timeoutMs);
    const onAbort = () => this.finish(requestId, { kind: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
    this.pending.set(requestId, {
      connId,
      settle: (outcome) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      },
    });
  }

  private finish(requestId: string, outcome: GuestOutcome): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }
    this.pending.delete(requestId);
    entry.settle(outcome);
  }
}

/** Build an isolated registry. Tests inject a short timeout and fixed request ids. */
export function createGuestRegistry(options: GuestRegistryOptions = {}): GuestRegistry {
  return new GuestRegistryImpl(options);
}

// Process-wide slot so the gateway handler and the browser tool share one registry
// even when the plugin is loaded through duplicate module instances.
const guestRegistryStore = createPluginRuntimeStore<GuestRegistry>({
  key: "browser.guest-registry",
  errorMessage: "Browser guest registry not initialized",
});

/** Return the shared registry for this process, creating it on first use. */
export function getBrowserGuestRegistry(): GuestRegistry {
  const existing = guestRegistryStore.tryGetRuntime();
  if (existing) {
    return existing;
  }
  const created = createGuestRegistry();
  guestRegistryStore.setRuntime(created);
  return created;
}
