// Types for the part of the engine's browser gateway client the phone uses. The code itself is the
// engine's own (engine/packages/gateway-client/src/browser.ts, compiled from source by
// engine-modules.js); the engine typechecks it there. These declarations copy its signatures for the
// members this app calls, so the app typechecks without installing the engine's dependencies.
declare module '@branch/gateway-client/browser' {
  export const PROTOCOL_VERSION: number;
  export const MIN_CLIENT_PROTOCOL_VERSION: number;

  export const GATEWAY_CLIENT_IDS: {
    readonly WEBCHAT_UI: 'webchat-ui';
    readonly IOS_APP: 'branch-ios';
    readonly ANDROID_APP: 'branch-android';
  };
  export const GATEWAY_CLIENT_MODES: { readonly WEBCHAT: 'webchat'; readonly UI: 'ui' };

  export const ConnectErrorDetailCodes: {
    readonly AUTH_BOOTSTRAP_TOKEN_INVALID: 'AUTH_BOOTSTRAP_TOKEN_INVALID';
    readonly PAIRING_REQUIRED: 'PAIRING_REQUIRED';
    readonly PAIRING_REJECTED: 'PAIRING_REJECTED';
    readonly PAIRING_EXPIRED: 'PAIRING_EXPIRED';
    readonly AUTH_DEVICE_TOKEN_MISMATCH: 'AUTH_DEVICE_TOKEN_MISMATCH';
    readonly AUTH_SCOPE_MISMATCH: 'AUTH_SCOPE_MISMATCH';
    readonly AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED';
    readonly DEVICE_IDENTITY_REQUIRED: 'DEVICE_IDENTITY_REQUIRED';
    readonly DEVICE_AUTH_INVALID: 'DEVICE_AUTH_INVALID';
    readonly DEVICE_AUTH_DEVICE_ID_MISMATCH: 'DEVICE_AUTH_DEVICE_ID_MISMATCH';
    readonly DEVICE_AUTH_SIGNATURE_INVALID: 'DEVICE_AUTH_SIGNATURE_INVALID';
    readonly DEVICE_AUTH_PUBLIC_KEY_INVALID: 'DEVICE_AUTH_PUBLIC_KEY_INVALID';
    readonly PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH';
    readonly CLIENT_VERSION_MISMATCH: 'CLIENT_VERSION_MISMATCH';
  };
  export function readConnectErrorDetailCode(details: unknown): string | null;
  export function readPairingConnectErrorDetails(
    details: unknown,
  ): { requestId?: string; reason?: string } | null;
  export function shouldPauseGatewayReconnect(params: { details?: unknown }): boolean;

  export type ConnectParams = {
    minProtocol: number;
    maxProtocol: number;
    client: {
      id: string;
      displayName?: string;
      version: string;
      platform: string;
      deviceFamily?: string;
      mode: string;
    };
    role?: string;
    scopes?: string[];
    caps?: string[];
    device?: { id: string; publicKey: string; signature: string; signedAt: number; nonce: string };
    auth?: { token?: string; bootstrapToken?: string; deviceToken?: string; password?: string };
  };

  export type HelloOk = {
    type: 'hello-ok';
    protocol: number;
    server: { version: string };
    auth: { role: string; scopes: string[]; deviceToken?: string };
    snapshot?: { sessionDefaults?: { mainSessionKey?: string } } & Record<string, unknown>;
  };

  export type EventFrame = { type: 'event'; event: string; payload?: unknown; seq?: number };

  export type GatewayBrowserDeviceIdentity = {
    deviceId: string;
    publicKey: string;
    sign: (payload: string) => Promise<string>;
  };
  export type GatewayBrowserDeviceTokenRecord = { token: string; scopes: string[] };
  type TokenKey = { clientId: string; deviceId: string; role: string };
  export type GatewayBrowserDeviceTokenStore = {
    load: (key: TokenKey) => GatewayBrowserDeviceTokenRecord | null | Promise<GatewayBrowserDeviceTokenRecord | null>;
    store: (record: TokenKey & GatewayBrowserDeviceTokenRecord) => void | Promise<void>;
    clear: (key: TokenKey) => void | Promise<void>;
  };
  export type GatewayBrowserDeviceAuthPlan = {
    clientId: string;
    role: string;
    identity: GatewayBrowserDeviceIdentity | null;
    scopes: string[];
    device?: NonNullable<ConnectParams['device']>;
    auth?: ConnectParams['auth'];
  };
  export class GatewayBrowserDeviceAuthLifecycle {
    constructor(deps: {
      loadIdentity: () => Promise<GatewayBrowserDeviceIdentity | null>;
      tokenStore: GatewayBrowserDeviceTokenStore;
    });
    buildPlan(params: {
      client: ConnectParams['client'];
      role: string;
      defaultScopes: readonly string[];
      bootstrapScopes?: readonly string[];
      bootstrapToken?: string;
      nonce: string | null;
      challengeTs?: number | null;
    }): Promise<GatewayBrowserDeviceAuthPlan>;
    acceptHello(hello: Pick<HelloOk, 'auth'>, plan: GatewayBrowserDeviceAuthPlan): Promise<void>;
  }

  export type GatewayProtocolSocketHandlers = {
    open: () => void;
    message: (data: string) => void;
    close: (code: number, reason: string) => void;
    error: (error: Error) => void;
  };
  export type GatewayProtocolSocket = {
    isOpen: () => boolean;
    send: (data: string) => void;
    close: (code?: number, reason?: string) => void;
  };
  export type GatewayProtocolCloseContext = {
    code: number;
    reason: string;
    connectFailure?: { error: Error; reconnectDelayMs?: number };
  };
  export type GatewayProtocolCloseDecision = {
    retry: boolean;
    notify: boolean;
    reconnectDelayMs?: number;
    pendingError?: Error;
  };
  export class GatewayProtocolClient<TPlan> {
    constructor(opts: {
      createSocket: (handlers: GatewayProtocolSocketHandlers) => GatewayProtocolSocket;
      createRequestId: () => string;
      buildConnectPlan: (context: { nonce: string | null; challengeTs: number | null }) => TPlan | Promise<TPlan>;
      buildConnectParams: (plan: TPlan) => ConnectParams;
      onConnectHello?: (hello: HelloOk, context: { plan: TPlan }) => void | Promise<void>;
      onHello?: (hello: HelloOk) => void;
      onConnectFailure?: (error: Error & { details?: unknown }) => {
        closeCode: number;
        closeReason: string;
        reconnectDelayMs?: number;
      };
      resolveClose: (context: GatewayProtocolCloseContext) => GatewayProtocolCloseDecision;
      onClose?: (context: GatewayProtocolCloseContext, decision: GatewayProtocolCloseDecision) => void;
      handshake: { mode: 'require-challenge' | 'fallback'; timeoutMs: number };
      reconnect: { initialMs: number; multiplier: number; maxMs: number };
    });
    start(): void;
    stop(): void;
    request<T = unknown>(method: string, params?: unknown): Promise<T>;
    addEventListener(listener: (event: EventFrame) => void): () => void;
    closeSocket(code?: number, reason?: string): void;
  }

  /** Connection-owned chat baselines (engine/packages/gateway-client/src/chat-stream-projection.ts). */
  export class GatewayChatStreamProjection {
    project<T extends { event: string; payload?: unknown }>(event: T): { event: T; missingBaseline: boolean };
    retire(isRetired: (scope: { sessionKey: string; agentId: unknown }) => boolean): void;
    clear(): void;
  }
}
