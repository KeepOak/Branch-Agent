// The phone's connection to the engine gateway on the computer: the window's BranchGateway
// (window/src/connect/gateway.ts) on the engine's own client, with a phone's identity and scopes and the
// pairing code's bootstrap token for the first connect.
import {
  ConnectErrorDetailCodes,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  GatewayBrowserDeviceAuthLifecycle,
  GatewayChatStreamProjection,
  GatewayProtocolClient,
  MIN_CLIENT_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  readConnectErrorDetailCode,
  readPairingConnectErrorDetails,
  shouldPauseGatewayReconnect,
  type ConnectParams,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
  type GatewayBrowserDeviceTokenStore,
  type GatewayProtocolCloseContext,
  type GatewayProtocolSocket,
  type GatewayProtocolSocketHandlers,
  type HelloOk,
} from '@branch/gateway-client/browser';

export const OPERATOR_ROLE = 'operator';
/**
 * What a phone needs: read chats, send messages, answer approvals and questions. Never admin or
 * pairing, so a lost phone can't change the computer's settings or let other devices in. All four sit
 * inside the engine's bootstrap hand-off scopes (BOOTSTRAP_HANDOFF_OPERATOR_SCOPES).
 */
export const PHONE_SCOPES = ['operator.approvals', 'operator.questions', 'operator.read', 'operator.write'] as const;
const CONNECT_FAILED_CLOSE_CODE = 4008;
/** The Control UI's close for a chat addition whose frames before it this connection never had (engine/ui/src/api/gateway.ts). */
const CHAT_BASELINE_MISSING_CLOSE_CODE = 4000;
const PAIRING_RETRY_MS = 2000;
const STARTING_RETRY_MS = 1000;

export type Platform = 'ios' | 'android' | 'web';

export type GatewayStatus =
  | { phase: 'connecting' }
  | { phase: 'pairing'; requestId?: string; reason?: string }
  | { phase: 'connected'; hello: HelloOk }
  | { phase: 'failed'; message: string; code?: string };

export type PhoneGatewayOptions = {
  url: string;
  platform: Platform;
  appVersion: string;
  /** From the pairing code; only sent until the engine has issued this phone a device token. */
  bootstrapToken?: string;
  loadIdentity: () => Promise<GatewayBrowserDeviceIdentity>;
  tokenStore: GatewayBrowserDeviceTokenStore;
  createRequestId: () => string;
  createSocket?: (url: string, handlers: GatewayProtocolSocketHandlers) => GatewayProtocolSocket;
  onStatus: (status: GatewayStatus) => void;
  /** How long to wait before asking again while the computer hasn't approved this phone yet. */
  pairingRetryMs?: number;
};

export function phoneClient(platform: Platform, appVersion: string): ConnectParams['client'] {
  if (platform === 'web') {
    return { id: GATEWAY_CLIENT_IDS.WEBCHAT_UI, displayName: 'Branch phone preview', version: appVersion, platform, mode: GATEWAY_CLIENT_MODES.WEBCHAT };
  }
  return {
    id: platform === 'ios' ? GATEWAY_CLIENT_IDS.IOS_APP : GATEWAY_CLIENT_IDS.ANDROID_APP,
    displayName: 'Branch',
    version: appVersion,
    platform,
    mode: GATEWAY_CLIENT_MODES.UI,
  };
}

function webSocketFor(url: string, handlers: GatewayProtocolSocketHandlers): GatewayProtocolSocket {
  const socket = new WebSocket(url);
  socket.onopen = () => handlers.open();
  socket.onmessage = (event) => handlers.message(String(event.data ?? ''));
  socket.onclose = (event) => handlers.close(event.code, event.reason);
  socket.onerror = () => handlers.error(new Error('websocket error'));
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
}

function isPairingRequired(details: unknown): boolean {
  return readConnectErrorDetailCode(details) === ConnectErrorDetailCodes.PAIRING_REQUIRED;
}

function isEngineStarting(details: unknown): boolean {
  return typeof details === 'object' && details !== null && (details as { reason?: unknown }).reason === 'startup-sidecars';
}

export class PhoneGateway {
  readonly client: ConnectParams['client'];
  private readonly protocol: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>;
  private readonly auth: GatewayBrowserDeviceAuthLifecycle;
  private bootstrapToken: string | undefined;
  /**
   * Each reply's whole text so far, rebuilt from this connection's frames, as the Control UI keeps it
   * (engine/ui/src/api/gateway-chat-events.ts). The engine sends a connection a reply's whole text only in its first
   * frame for the run and in replacements, then additions alone (server-broadcast-live-text.ts `canSendDelta`), and
   * it keeps that per connection, not per screen: a reply that streamed while Chats was open arrives at a chat opened
   * later as bare additions. Rebuilding here gives every `chat` frame its whole text, whichever screen was open.
   */
  private readonly chatStream = new GatewayChatStreamProjection();
  private readonly listeners = new Set<(event: EventFrame) => void>();

  constructor(private readonly opts: PhoneGatewayOptions) {
    this.client = phoneClient(opts.platform, opts.appVersion);
    this.bootstrapToken = opts.bootstrapToken;
    this.auth = new GatewayBrowserDeviceAuthLifecycle({ loadIdentity: opts.loadIdentity, tokenStore: opts.tokenStore });
    const pairingRetryMs = opts.pairingRetryMs ?? PAIRING_RETRY_MS;
    const createSocket = opts.createSocket ?? webSocketFor;
    this.protocol = new GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>({
      createSocket: (handlers) => {
        // The texts belong to the connection that carried them.
        this.chatStream.clear();
        return createSocket(opts.url, handlers);
      },
      createRequestId: opts.createRequestId,
      buildConnectPlan: ({ nonce, challengeTs }) =>
        this.auth.buildPlan({
          client: this.client,
          role: OPERATOR_ROLE,
          defaultScopes: PHONE_SCOPES,
          bootstrapScopes: PHONE_SCOPES,
          bootstrapToken: this.bootstrapToken,
          nonce,
          challengeTs,
        }),
      buildConnectParams: (plan) => ({
        minProtocol: MIN_CLIENT_PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: this.client,
        role: plan.role,
        scopes: plan.scopes,
        caps: [],
        ...(plan.device ? { device: plan.device } : {}),
        ...(plan.auth ? { auth: plan.auth } : {}),
      }),
      onConnectHello: async (hello, { plan }) => {
        await this.auth.acceptHello(hello, plan);
        // The engine has issued this phone its own token; the one-time pairing token is spent.
        if (hello.auth.deviceToken) this.bootstrapToken = undefined;
      },
      onHello: (hello) => opts.onStatus({ phase: 'connected', hello }),
      onConnectFailure: (error) => ({
        closeCode: CONNECT_FAILED_CLOSE_CODE,
        closeReason: 'connect failed',
        ...(isPairingRequired(error.details) ? { reconnectDelayMs: pairingRetryMs } : {}),
        ...(isEngineStarting(error.details) ? { reconnectDelayMs: STARTING_RETRY_MS } : {}),
      }),
      resolveClose: (context) => {
        const error = context.connectFailure?.error;
        const details = (error as { details?: unknown } | undefined)?.details;
        if (isPairingRequired(details)) return { retry: true, notify: true, reconnectDelayMs: pairingRetryMs, pendingError: error };
        if (isEngineStarting(details)) return { retry: true, notify: true, reconnectDelayMs: STARTING_RETRY_MS, pendingError: error };
        return { retry: !shouldPauseGatewayReconnect({ details }), notify: true, pendingError: error };
      },
      onClose: (context, decision) => {
        this.chatStream.clear();
        this.reportClose(context, decision.retry);
      },
      handshake: { mode: 'require-challenge', timeoutMs: 10_000 },
      reconnect: { initialMs: 800, multiplier: 1.7, maxMs: 5_000 },
    });
    this.protocol.addEventListener((event) => this.dispatch(event));
  }

  start(): void {
    this.opts.onStatus({ phase: 'connecting' });
    this.protocol.start();
  }

  stop(): void {
    this.chatStream.clear();
    this.protocol.stop();
  }

  /** One request to the engine over the open connection; rejects while it is closed. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.protocol.request<T>(method, params);
  }

  /** Every event the engine pushes on this connection (sessions.changed, chat, approvals…), each `chat` frame with its whole text. */
  addEventListener(listener: (event: EventFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Gives each `chat` frame its reply's whole text once, for every listener. */
  private dispatch(event: EventFrame): void {
    const { event: projected, missingBaseline } = this.chatStream.project(event);
    if (missingBaseline) {
      // An addition to text this connection never had: start a new connection, whose first frame carries it all.
      this.protocol.closeSocket(CHAT_BASELINE_MISSING_CLOSE_CODE, 'chat stream baseline missing');
      return;
    }
    for (const listener of [...this.listeners]) listener(projected);
  }

  private reportClose(context: GatewayProtocolCloseContext, willRetry: boolean): void {
    const error = context.connectFailure?.error;
    const details = (error as { details?: unknown } | undefined)?.details;
    if (isPairingRequired(details)) {
      const pairing = readPairingConnectErrorDetails(details);
      this.opts.onStatus({
        phase: 'pairing',
        ...(pairing?.requestId ? { requestId: pairing.requestId } : {}),
        ...(pairing?.reason ? { reason: pairing.reason } : {}),
      });
      return;
    }
    if (willRetry) {
      this.opts.onStatus({ phase: 'connecting' });
      return;
    }
    const code = readConnectErrorDetailCode(details) ?? undefined;
    this.opts.onStatus({ phase: 'failed', message: error?.message ?? `closed (${context.code})`, ...(code ? { code } : {}) });
  }
}
