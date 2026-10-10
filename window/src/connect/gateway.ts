// The window's connection to the engine's gateway. It drives Branch Agent's own wire client
// (GatewayProtocolClient and GatewayBrowserDeviceAuthLifecycle from @branch/gateway-client/browser),
// the way Branch Agent's Control UI does in ui/src/api/gateway.ts at openclaw/openclaw@57e0aaa1c190.
import {
  ConnectErrorDetailCodes,
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  MIN_CLIENT_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  readConnectErrorDetailCode,
  readPairingConnectErrorDetails,
  shouldPauseGatewayReconnect,
  type ConnectParams,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceTokenStore,
  type GatewayProtocolCloseContext,
  type GatewayProtocolRequestOptions,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from "@branch/gateway-client/browser";
import { loadBrowserDeviceIdentity } from "./device-identity";
import { createDeviceTokenStore } from "./device-token-store";
import type { ScopeUpgradeOutcome } from "./engine";

type ScopeUpgradeBinding = { clientId: string; deviceId: string; role: string };
type ScopeUpgradeRuntime = {
  requestScopeUpgrade: (options: {
    binding: ScopeUpgradeBinding;
    scopes: readonly string[];
    onPending?: (requestId: string) => void;
  }) => Promise<ScopeUpgradeOutcome>;
  cancelScopeUpgrade: () => void;
};

import { recordRequest } from "../diagnostics/ui-log";

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "error";
}

export const OPERATOR_ROLE = "operator";
/** The same scopes OpenClaw's own browser UI asks for (ui/src/api/gateway-connect-plan.ts, CONTROL_UI_OPERATOR_SCOPES). */
export const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
] as const;
/** Only what the window implements: live tool steps and exec approval cards. */
export const CLIENT_CAPS = [GATEWAY_CLIENT_CAPS.TOOL_EVENTS, GATEWAY_CLIENT_CAPS.EXEC_APPROVALS];
const CONNECT_FAILED_CLOSE_CODE = 4008;
const PAIRING_RETRY_MS = 2000;
/** The engine turns connects away while it starts; it says so with this reason. */
const STARTING_RETRY_MS = 1000;

export type GatewayStatus =
  | { phase: "connecting" }
  /** `reason`: why the engine asks (not-paired: it doesn't know this device, or no longer does; scope-upgrade and
   *  the like: it does, and wants approval for more). */
  | { phase: "pairing"; requestId?: string; reason?: string }
  | { phase: "connected"; hello: HelloOk }
  | { phase: "failed"; message: string; /** The engine's connect error detail code (ConnectErrorDetailCodes), when it gave one. */ code?: string };

type Options = {
  url: string;
  /** The engine's shared token; only needed until this browser holds a device token. */
  sharedToken?: string;
  onStatus: (status: GatewayStatus) => void;
  onEvent: (event: EventFrame) => void;
};

function createBrowserSocket(url: string, handlers: GatewayProtocolSocketHandlers): GatewayProtocolSocket {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => handlers.open());
  socket.addEventListener("message", (event) => handlers.message(String(event.data ?? "")));
  socket.addEventListener("close", (event) => handlers.close(event.code, event.reason));
  socket.addEventListener("error", () => handlers.error(new Error("websocket error")));
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
}

function clientInfo(): ConnectParams["client"] {
  return {
    id: GATEWAY_CLIENT_IDS.WEBCHAT_UI,
    displayName: "Branch",
    version: "branch-window",
    platform: navigator.platform || "web",
    mode: GATEWAY_CLIENT_MODES.WEBCHAT,
  };
}

/** True when the engine turned the connect away only because it is still starting. */
export function isEngineStarting(details: unknown): boolean {
  return typeof details === "object" && details !== null && (details as { reason?: unknown }).reason === "startup-sidecars";
}

function isPairingRequired(details: unknown): boolean {
  return readConnectErrorDetailCode(details) === ConnectErrorDetailCodes.PAIRING_REQUIRED;
}

export class BranchGateway {
  private readonly client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>;
  private readonly auth: GatewayBrowserDeviceAuthLifecycle;
  private readonly tokenStore: GatewayBrowserDeviceTokenStore;
  private readonly opts: Options;

  private connected = false;
  private scopeUpgradeBinding: ScopeUpgradeBinding | null = null;
  private scopeUpgradeRuntime: Promise<ScopeUpgradeRuntime> | null = null;

  constructor(opts: Options) {
    this.opts = opts;
    this.tokenStore = createDeviceTokenStore(opts.url);
    this.auth = new GatewayBrowserDeviceAuthLifecycle({
      loadIdentity: loadBrowserDeviceIdentity,
      tokenStore: this.tokenStore,
    });
    this.client = new GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>({
      createSocket: (handlers) => createBrowserSocket(opts.url, handlers),
      createRequestId: () => crypto.randomUUID(),
      buildConnectPlan: ({ nonce, challengeTs }) =>
        this.auth.buildPlan({
          client: clientInfo(),
          role: OPERATOR_ROLE,
          defaultScopes: OPERATOR_SCOPES,
          token: opts.sharedToken,
          nonce,
          challengeTs,
        }),
      buildConnectParams: (plan) => this.connectParams(plan),
      onConnectHello: (hello, context) => {
        const plan = context.plan;
        this.scopeUpgradeBinding = plan.identity
          ? { clientId: plan.clientId, deviceId: plan.identity.deviceId, role: plan.role }
          : null;
        return this.auth.acceptHello(hello, plan);
      },
      onHello: (hello) => {
        this.connected = true;
        opts.onStatus({ phase: "connected", hello });
      },
      onConnectFailure: (error) => ({
        closeCode: CONNECT_FAILED_CLOSE_CODE,
        closeReason: "connect failed",
        ...(isPairingRequired(error.details) ? { reconnectDelayMs: PAIRING_RETRY_MS } : {}),
        ...(isEngineStarting(error.details) ? { reconnectDelayMs: STARTING_RETRY_MS } : {}),
      }),
      resolveClose: (context) => this.resolveClose(context),
      onClose: (context, decision) => {
        this.connected = false;
        this.reportClose(context, decision.retry);
      },
      onEvent: (event) => opts.onEvent(event),
      handshake: { mode: "require-challenge", timeoutMs: 10_000 },
      // The engine is local: while it restarts or updates, look again every few seconds at most,
      // so the window is back within moments of the engine accepting connections.
      reconnect: { initialMs: 800, multiplier: 1.7, maxMs: 3_000 },
    });
  }

  start(): void {
    this.opts.onStatus({ phase: "connecting" });
    this.client.start();
  }

  stop(): void {
    this.cancelScopeUpgrade();
    this.scopeUpgradeBinding = null;
    this.client.stop();
  }

  /** The engine came back (the desktop swapped it in place): try now instead of at the next backoff step. */
  reconnectNow(): void {
    if (this.connected) return;
    this.client.stop();
    this.start();
  }

  request<T = unknown>(method: string, params?: unknown, options?: GatewayProtocolRequestOptions): Promise<T> {
    const started = Date.now();
    const sent = this.client.request<T>(method, params, options);
    // The diagnostics log keeps the method, the outcome and the time. Params and results are never recorded.
    sent.then(
      () => recordRequest(method, true, undefined, Date.now() - started),
      (error: unknown) => recordRequest(method, false, errorCodeOf(error), Date.now() - started),
    );
    return sent;
  }

  /** Ask an owner for the full operator scopes; persist the rotated device key the way the upstream client does. */
  async requestScopeUpgrade(options: { onPending?: (requestId: string) => void } = {}): Promise<ScopeUpgradeOutcome> {
    const binding = this.scopeUpgradeBinding;
    if (!this.connected || !binding) {
      throw new Error("This window isn’t signed in as a device yet. Refresh and try again.");
    }
    const runtime = await this.loadScopeUpgrade();
    return runtime.requestScopeUpgrade({
      binding,
      scopes: OPERATOR_SCOPES,
      onPending: options.onPending,
    });
  }

  cancelScopeUpgrade(): void {
    void this.scopeUpgradeRuntime
      ?.then((runtime) => runtime.cancelScopeUpgrade())
      .catch(() => undefined);
  }

  private loadScopeUpgrade(): Promise<ScopeUpgradeRuntime> {
    return (this.scopeUpgradeRuntime ??= import("@branch/gateway-client/scope-upgrade")
      .then(({ GatewayScopeUpgrade }) => new GatewayScopeUpgrade({
        request: (method, params, options) => this.request(method, params, options),
        tokenStore: this.tokenStore,
        reconnect: () => this.client.closeSocket(4000, "scope upgrade approved"),
      }))
      .catch((error: unknown) => {
        this.scopeUpgradeRuntime = null;
        throw error;
      }));
  }

  private connectParams(plan: GatewayBrowserDeviceAuthPlan): ConnectParams {
    return {
      minProtocol: MIN_CLIENT_PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: clientInfo(),
      role: plan.role,
      scopes: plan.scopes,
      caps: [...CLIENT_CAPS],
      ...(plan.device ? { device: plan.device } : {}),
      ...(plan.auth ? { auth: plan.auth } : {}),
    };
  }

  private resolveClose(context: GatewayProtocolCloseContext) {
    const error = context.connectFailure?.error;
    const details = (error as { details?: unknown } | undefined)?.details;
    if (isPairingRequired(details)) {
      return { retry: true, notify: true, reconnectDelayMs: PAIRING_RETRY_MS, pendingError: error };
    }
    if (isEngineStarting(details)) {
      return { retry: true, notify: true, reconnectDelayMs: STARTING_RETRY_MS, pendingError: error };
    }
    return { retry: !shouldPauseGatewayReconnect({ details }), notify: true, pendingError: error };
  }

  private reportClose(context: GatewayProtocolCloseContext, willRetry: boolean): void {
    const error = context.connectFailure?.error;
    const details = (error as { details?: unknown } | undefined)?.details;
    if (isPairingRequired(details)) {
      const pairing = readPairingConnectErrorDetails(details);
      this.opts.onStatus({ phase: "pairing", requestId: pairing?.requestId, ...(pairing?.reason ? { reason: pairing.reason } : {}) });
      return;
    }
    if (willRetry) {
      this.opts.onStatus({ phase: "connecting" });
      return;
    }
    const code = readConnectErrorDetailCode(details) ?? undefined;
    this.opts.onStatus({ phase: "failed", message: error?.message ?? `closed (${context.code})`, ...(code ? { code } : {}) });
  }
}
