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
  type GatewayProtocolCloseContext,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from "@branch/gateway-client/browser";
import { loadBrowserDeviceIdentity } from "./device-identity";
import { createDeviceTokenStore } from "./device-token-store";

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

export type GatewayStatus =
  | { phase: "connecting" }
  | { phase: "pairing"; requestId?: string }
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

function isPairingRequired(details: unknown): boolean {
  return readConnectErrorDetailCode(details) === ConnectErrorDetailCodes.PAIRING_REQUIRED;
}

export class BranchGateway {
  private readonly client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>;
  private readonly auth: GatewayBrowserDeviceAuthLifecycle;
  private readonly opts: Options;

  constructor(opts: Options) {
    this.opts = opts;
    this.auth = new GatewayBrowserDeviceAuthLifecycle({
      loadIdentity: loadBrowserDeviceIdentity,
      tokenStore: createDeviceTokenStore(opts.url),
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
      onConnectHello: (hello, context) => this.auth.acceptHello(hello, context.plan),
      onHello: (hello) => opts.onStatus({ phase: "connected", hello }),
      onConnectFailure: (error) => ({
        closeCode: CONNECT_FAILED_CLOSE_CODE,
        closeReason: "connect failed",
        ...(isPairingRequired(error.details) ? { reconnectDelayMs: PAIRING_RETRY_MS } : {}),
      }),
      resolveClose: (context) => this.resolveClose(context),
      onClose: (context, decision) => this.reportClose(context, decision.retry),
      onEvent: (event) => opts.onEvent(event),
      handshake: { mode: "require-challenge", timeoutMs: 10_000 },
      reconnect: { initialMs: 800, multiplier: 1.7, maxMs: 15_000 },
    });
  }

  start(): void {
    this.opts.onStatus({ phase: "connecting" });
    this.client.start();
  }

  stop(): void {
    this.client.stop();
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.client.request<T>(method, params);
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
    return { retry: !shouldPauseGatewayReconnect({ details }), notify: true, pendingError: error };
  }

  private reportClose(context: GatewayProtocolCloseContext, willRetry: boolean): void {
    const error = context.connectFailure?.error;
    const details = (error as { details?: unknown } | undefined)?.details;
    if (isPairingRequired(details)) {
      const pairing = readPairingConnectErrorDetails(details);
      this.opts.onStatus({ phase: "pairing", requestId: pairing?.requestId });
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
