// A stand-in for the engine gateway's WebSocket, for tests and screenshots. It speaks the real wire
// protocol (connect.challenge, the connect request, hello-ok or a PAIRING_REQUIRED error) and checks the
// phone's Ed25519 signature over the engine's v3 device-auth payload, so the engine's own client code in
// PhoneGateway runs exactly as it would against a computer. After the handshake it answers the reads the
// Chats screen makes (sessions.subscribe, sessions.list, agents.list, sessions.search), the Chat screen's
// chat.history, chat.send, chat.abort and sessions.patch, and pushes events.
import { verify } from '@noble/ed25519';
import type { ConnectParams, GatewayProtocolSocket, GatewayProtocolSocketHandlers } from '@branch/gateway-client/browser';
import { base64UrlToBytes, utf8ToBytes } from './base64url';

export type FakeEngine = {
  createSocket: (url: string, handlers: GatewayProtocolSocketHandlers) => GatewayProtocolSocket;
  /** Every connect request the phone sent, in order. */
  connects: ConnectParams[];
  urls: string[];
  /** Whether each connect's device signature checked out. */
  signaturesValid: boolean[];
  approve: () => void;
  reject: () => void;
  /** Drops the phone's connection the way an engine restart does. */
  drop: () => void;
  readonly openSockets: number;
  /** Every request after the handshake, in order. */
  requests: Array<{ method: string; params: unknown }>;
  /** The sessions.list rows the engine reports from now on. */
  setSessions: (rows: unknown[]) => void;
  /** Pushes one event to every connected phone. */
  emit: (event: string, payload?: unknown) => void;
  /** Makes one method fail with this message until cleared with null. */
  failMethod: (method: string, message: string | null) => void;
  /** The chat.history messages (and the run still going, if any) the engine reports for a chat from now on. */
  setHistory: (sessionKey: string, messages: unknown[], inFlightRun?: unknown) => void;
};

export type FakeEngineOptions = {
  version?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  sessions?: unknown[];
  /** The agents.list payload. */
  agents?: unknown;
};

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const version = options.version ?? '2026.10.8';
  const bootstrapToken = options.bootstrapToken ?? 'boot-1';
  const deviceToken = options.deviceToken ?? 'device-token-1';
  let decision: 'pending' | 'approved' | 'rejected' = 'pending';
  let sessions = options.sessions ?? [];
  const agents = options.agents ?? { defaultId: 'main', mainKey: 'main', scope: 'per-sender', agents: [{ id: 'main', name: 'Branch Agent' }] };
  const failures = new Map<string, string>();
  const histories = new Map<string, { messages: unknown[]; inFlightRun?: unknown }>();
  const live = new Set<{ close: (code: number, reason: string) => void; event: (frame: unknown) => void }>();
  const answer = (method: string, params: unknown): { ok: true; payload: unknown } | { ok: false; message: string } => {
    const failure = failures.get(method);
    if (failure) return { ok: false, message: failure };
    switch (method) {
      case 'sessions.subscribe':
        return { ok: true, payload: { subscribed: true, list: { sessions } } };
      case 'sessions.list':
        return { ok: true, payload: { sessions } };
      case 'agents.list':
        return { ok: true, payload: agents };
      case 'sessions.search': {
        // The last line of each chat stands in for its transcript.
        const q = String((params as { query?: unknown } | null)?.query ?? '').toLowerCase();
        const results = (sessions as Array<Record<string, unknown>>)
          .filter((s) => q && String(s.lastMessagePreview ?? '').toLowerCase().includes(q))
          .map((s) => ({ sessionKey: s.key, role: 'assistant', snippet: s.lastMessagePreview, timestamp: s.updatedAt, messageId: `m-${String(s.key)}` }));
        return { ok: true, payload: { results } };
      }
      case 'chat.history': {
        const key = String((params as { sessionKey?: unknown } | null)?.sessionKey ?? '');
        const history = histories.get(key);
        return { ok: true, payload: { sessionKey: key, messages: history?.messages ?? [], ...(history?.inFlightRun ? { inFlightRun: history.inFlightRun } : {}) } };
      }
      case 'chat.send':
        return { ok: true, payload: { runId: (params as { idempotencyKey?: unknown } | null)?.idempotencyKey, status: 'started' } };
      case 'chat.abort':
        return { ok: true, payload: { ok: true, aborted: true } };
      case 'sessions.patch': {
        // Like the engine: the row changes and every phone hears sessions.changed.
        const { key, unread } = (params ?? {}) as { key?: string; unread?: boolean };
        if (typeof unread === 'boolean') sessions = (sessions as Array<Record<string, unknown>>).map((row) => (row.key === key ? { ...row, unread } : row));
        setTimeout(() => engine.emit('sessions.changed', { sessionKey: key }), 0);
        return { ok: true, payload: { ok: true, key } };
      }
      default:
        return { ok: true, payload: {} };
    }
  };
  const engine: FakeEngine = {
    connects: [],
    urls: [],
    signaturesValid: [],
    requests: [],
    setSessions: (rows) => {
      sessions = rows;
    },
    emit: (event, payload = {}) => {
      for (const socket of [...live]) socket.event({ type: 'event', event, payload });
    },
    setHistory: (sessionKey, messages, inFlightRun) => {
      histories.set(sessionKey, { messages, ...(inFlightRun ? { inFlightRun } : {}) });
    },
    failMethod: (method, message) => {
      if (message === null) failures.delete(method);
      else failures.set(method, message);
    },
    approve: () => {
      decision = 'approved';
    },
    reject: () => {
      decision = 'rejected';
    },
    drop: () => {
      for (const socket of [...live]) socket.close(1012, 'engine restarting');
    },
    get openSockets() {
      return live.size;
    },
    createSocket(url, handlers) {
      engine.urls.push(url);
      let open = true;
      const nonce = `nonce-${engine.urls.length}`;
      const challengeTs = 1_800_000_000_000 + engine.urls.length;
      const reply = (frame: unknown) => setTimeout(() => open && handlers.message(JSON.stringify(frame)), 0);
      const close = (code: number, reason: string) => {
        if (!open) return;
        open = false;
        live.delete(entry);
        setTimeout(() => handlers.close(code, reason), 0);
      };
      let helloSent = false;
      const entry = { close, event: (frame: unknown) => helloSent && reply(frame) };
      live.add(entry);
      setTimeout(() => {
        if (!open) return;
        handlers.open();
        reply({ type: 'event', event: 'connect.challenge', payload: { nonce, ts: challengeTs } });
      }, 0);
      return {
        isOpen: () => open,
        close: (code = 1000, reason = '') => close(code, reason),
        send(data) {
          const frame = JSON.parse(data) as { id: string; method: string; params: ConnectParams };
          if (frame.method !== 'connect') {
            engine.requests.push({ method: frame.method, params: frame.params });
            const result = answer(frame.method, frame.params);
            reply(
              result.ok
                ? { type: 'res', id: frame.id, ok: true, payload: result.payload }
                : { type: 'res', id: frame.id, ok: false, error: { code: 'UNAVAILABLE', message: result.message } },
            );
            return;
          }
          const params = frame.params;
          engine.connects.push(params);
          const device = params.device;
          const token = params.auth?.deviceToken ?? params.auth?.bootstrapToken ?? '';
          const signed = device
            ? [
                'v3', device.id, params.client.id, params.client.mode, params.role, (params.scopes ?? []).join(','),
                String(device.signedAt), token, device.nonce, params.client.platform.toLowerCase(), '',
              ].join('|')
            : '';
          engine.signaturesValid.push(
            !!device &&
              device.nonce === nonce &&
              device.signedAt === challengeTs &&
              verify(base64UrlToBytes(device.signature), utf8ToBytes(signed), base64UrlToBytes(device.publicKey)),
          );
          const knownDevice = params.auth?.deviceToken === deviceToken;
          if (knownDevice || (params.auth?.bootstrapToken === bootstrapToken && decision === 'approved')) {
            helloSent = true;
            reply({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {
                type: 'hello-ok',
                protocol: 4,
                server: { version },
                features: { methods: [], events: [] },
                snapshot: {},
                auth: { method: knownDevice ? 'device-token' : 'bootstrap-token', role: 'operator', scopes: params.scopes, deviceToken },
                policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 3_600_000 },
              },
            });
            return;
          }
          const details =
            decision === 'rejected'
              ? { code: 'PAIRING_REJECTED' }
              : params.auth?.bootstrapToken === bootstrapToken
                ? { code: 'PAIRING_REQUIRED', requestId: 'request-1', reason: 'not-paired' }
                : { code: 'AUTH_BOOTSTRAP_TOKEN_INVALID' };
          reply({ type: 'res', id: frame.id, ok: false, error: { code: 'NOT_PAIRED', message: details.code.toLowerCase().replaceAll('_', ' '), details } });
        },
      };
    },
  };
  return engine;
}
