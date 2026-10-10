// A stand-in for the engine gateway's WebSocket, for tests and screenshots. It speaks the real wire
// protocol (connect.challenge, the connect request, hello-ok or a PAIRING_REQUIRED error) and checks the
// phone's Ed25519 signature over the engine's v3 device-auth payload, so the engine's own client code in
// PhoneGateway runs exactly as it would against a computer. After the handshake it answers the reads the
// Chats screen makes (sessions.subscribe, sessions.list, agents.list, sessions.search), the Chat screen's
// chat.history, chat.send, chat.abort and sessions.patch, the approvals' exec/plugin .approval.list and
// .approval.resolve, and pushes events. A reply streamed with `streamReply` reaches each connection the way the
// engine sends it: the whole text in that connection's first frame for the run and in replacements, and only the
// addition once the connection holds the frame before it. Approval events and methods follow the engine's
// per-connection rules: only a connection holding operator.approvals hears *.approval.* or may list and resolve,
// and a resolve broadcasts *.approval.resolved (naming the answering connection) before it answers that connection.
import { verify } from '@noble/ed25519';
import type { ConnectParams, GatewayProtocolSocket, GatewayProtocolSocketHandlers } from '@branch/gateway-client/browser';
import { base64UrlToBytes, utf8ToBytes } from './base64url';

const APPROVALS_SCOPE = 'operator.approvals';
const APPROVAL_EVENTS = new Set(['exec.approval.requested', 'exec.approval.resolved', 'plugin.approval.requested', 'plugin.approval.resolved']);

export type FakeEngine = {
  createSocket: (url: string, handlers: GatewayProtocolSocketHandlers) => GatewayProtocolSocket;
  /** Every connect request the phone sent, in order. */
  connects: ConnectParams[];
  urls: string[];
  /** Whether each connect's device signature checked out. */
  signaturesValid: boolean[];
  approve: () => void;
  /**
   * The owner chooses Deny. Like the engine (rejectDevicePairingInWorker), that drops the request and revokes
   * the pairing code, so every later try with it is answered AUTH_BOOTSTRAP_TOKEN_INVALID.
   */
  reject: () => void;
  /** Drops the phone's connection the way an engine restart does. */
  drop: () => void;
  /** Revokes the device token it issued, as removing the phone in Branch on the computer does. */
  revoke: () => void;
  /**
   * Turns every later connect away with this error (the engine's wire shape); null stops refusing. Refusing
   * with AUTH_BOOTSTRAP_TOKEN_INVALID means the code's record is gone, and null doesn't bring it back.
   */
  refuse: (refusal: { code: string; message: string } | null) => void;
  readonly openSockets: number;
  /** Every request after the handshake, in order. */
  requests: Array<{ method: string; params: unknown }>;
  /** The sessions.list rows the engine reports from now on. */
  setSessions: (rows: unknown[]) => void;
  /** Pushes one event to every connected phone, as it is. A `final`, `error` or `aborted` chat event ends that run's reply. */
  emit: (event: string, payload?: unknown) => void;
  /**
   * The reply `runId` in `sessionKey` now reads `text`. Each connected phone gets a `chat` delta: the whole text
   * (`message`) when it holds no earlier frame of this run or the text isn't the last one plus more, otherwise only
   * the addition (server-chat-live-text.ts `projectChatWireDelta`, server-broadcast-live-text.ts `canSendDelta`).
   * The engine keeps which frames a connection holds per connection, whichever chat the phone shows.
   */
  streamReply: (sessionKey: string, runId: string, text: string) => void;
  /** Every event a connected phone was sent, in order. */
  delivered: Array<{ event: string; payload: unknown }>;
  /** Holds the answers to a method until the returned release is called. The engine reads its answer when asked. */
  hold: (method: string) => () => void;
  /**
   * Makes one method fail with this message (and the engine's error details and code, if given) until cleared with
   * null. The code defaults to INVALID_REQUEST with details and UNAVAILABLE without.
   */
  failMethod: (method: string, message: string | null, details?: unknown, code?: string) => void;
  /** The chat.history messages (and the run still going, if any) the engine reports for a chat from now on. */
  setHistory: (sessionKey: string, messages: unknown[], inFlightRun?: unknown) => void;
  /** A Trunk asks for a yes: the approval joins the list and every approvals connection hears *.approval.requested. */
  requestApproval: (kind: 'exec' | 'plugin', record: FakeApproval) => void;
  /** Another surface (the window, a timeout) answers: it leaves the list and every approvals connection hears *.approval.resolved. */
  resolveApproval: (id: string, decision: string, resolvedBy?: string | null) => void;
  /** The approvals still waiting, by kind. */
  pendingApprovals: (kind: 'exec' | 'plugin') => FakeApproval[];
};

/** One pending approval as the engine lists it (approval-record-lookup.ts listVisiblePendingApprovalRequests). */
export type FakeApproval = { id: string; request: Record<string, unknown>; createdAtMs: number; expiresAtMs: number };

export type FakeEngineOptions = {
  version?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  sessions?: unknown[];
  /** The agents.list payload. */
  agents?: unknown;
  approvals?: { exec?: FakeApproval[]; plugin?: FakeApproval[] };
};

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const version = options.version ?? '2026.10.8';
  const bootstrapToken = options.bootstrapToken ?? 'boot-1';
  const deviceToken = options.deviceToken ?? 'device-token-1';
  let decision: 'pending' | 'approved' = 'pending';
  /** The pairing code's record was removed (Deny, run out, used): nothing brings it back. */
  let codeGone = false;
  let revoked = false;
  let refusal: { code: string; message: string } | null = null;
  let sessions = options.sessions ?? [];
  const agents = options.agents ?? { defaultId: 'main', mainKey: 'main', scope: 'per-sender', agents: [{ id: 'main', name: 'Branch Agent' }] };
  const failures = new Map<string, { message: string; details?: unknown; code?: string }>();
  const histories = new Map<string, { messages: unknown[]; inFlightRun?: unknown }>();
  const approvals = { exec: [...(options.approvals?.exec ?? [])], plugin: [...(options.approvals?.plugin ?? [])] };
  /** The first decision recorded for each answered approval, so a later answer gets the engine's reply to a repeat. */
  const decided = new Map<string, string>();
  const settle = (kind: 'exec' | 'plugin', id: string, decision: string, resolvedBy: string | null): boolean => {
    const record = approvals[kind].find((a) => a.id === id);
    if (!record) return false;
    approvals[kind] = approvals[kind].filter((a) => a.id !== id);
    decided.set(id, decision);
    // Like approval-shared.ts handleApprovalResolve: the resolution is broadcast to every approvals connection,
    // the answering one included, before the answering connection hears { ok: true }.
    engine.emit(`${kind}.approval.resolved`, { id, decision, resolvedBy, ts: Date.now(), request: record.request });
    return true;
  };
  const replies = new Map<string, { sessionKey: string; text: string; seq: number }>();
  const holds = new Map<string, Array<() => void>>();
  type Connection = {
    close: (code: number, reason: string) => void;
    /** Sends an event once the handshake is done; false before it. */
    event: (frame: { type: 'event'; event: string; payload: unknown }) => boolean;
    /** The runs whose frames this connection holds. */
    receipts: Set<string>;
    /** The scopes the engine granted this connection at hello. */
    scopes: readonly string[];
    /** Who the engine names as the resolver of an answer from this connection (client displayName, else id). */
    name: string | null;
  };
  const live = new Set<Connection>();
  const answer = (method: string, params: unknown, from: Connection): { ok: true; payload: unknown } | { ok: false; message: string; details?: unknown; code?: string } => {
    const failure = failures.get(method);
    if (failure) return { ok: false, ...failure };
    // methods/core-descriptors.ts: the approval methods need operator.approvals on the asking connection.
    if (/^(exec|plugin)\.approval\./.test(method) && !from.scopes.includes(APPROVALS_SCOPE)) {
      return { ok: false, code: 'FORBIDDEN', message: `missing scope: ${APPROVALS_SCOPE}`, details: { code: 'MISSING_SCOPE', missingScope: APPROVALS_SCOPE } };
    }
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
      case 'exec.approval.list':
        return { ok: true, payload: approvals.exec };
      case 'plugin.approval.list':
        return { ok: true, payload: approvals.plugin };
      case 'exec.approval.resolve':
      case 'plugin.approval.resolve': {
        const { id, decision } = (params ?? {}) as { id?: string; decision?: string };
        if (settle(method.startsWith('plugin') ? 'plugin' : 'exec', String(id), String(decision), from.name)) return { ok: true, payload: { ok: true } };
        // approval-shared.ts respondRepeatedApprovalResolution: the same answer again is fine, a different one is refused.
        const first = decided.get(String(id));
        if (first !== undefined) {
          return first === decision
            ? { ok: true, payload: { ok: true } }
            : { ok: false, message: 'approval already resolved', details: { reason: 'APPROVAL_ALREADY_RESOLVED' } };
        }
        // approval-record-lookup.ts respondUnknownOrExpiredApproval.
        return { ok: false, message: 'unknown or expired approval id', details: { reason: 'APPROVAL_NOT_FOUND' } };
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
    delivered: [],
    setSessions: (rows) => {
      sessions = rows;
    },
    emit: (event, payload = {}) => {
      const { runId, state } = (payload ?? {}) as { runId?: unknown; state?: unknown };
      if (event === 'chat' && typeof runId === 'string' && (state === 'final' || state === 'error' || state === 'aborted')) {
        replies.delete(runId);
        for (const socket of live) socket.receipts.delete(runId);
      }
      for (const socket of [...live]) {
        // server-broadcast-scopes.ts: approval events reach only connections holding operator.approvals.
        if (APPROVAL_EVENTS.has(event) && !socket.scopes.includes(APPROVALS_SCOPE)) continue;
        socket.event({ type: 'event', event, payload });
      }
    },
    streamReply: (sessionKey, runId, text) => {
      const before = replies.get(runId);
      const seq = (before?.seq ?? 0) + 1;
      const added = !before ? text : text.startsWith(before.text) ? text.slice(before.text.length) : null;
      replies.set(runId, { sessionKey, text, seq });
      const message = { role: 'assistant', content: [{ type: 'text', text }], timestamp: 1_800_000_000_000 + seq };
      for (const socket of [...live]) {
        const whole = added === null || !socket.receipts.has(runId);
        const payload = {
          runId,
          sessionKey,
          seq,
          state: 'delta',
          deltaText: added ?? text,
          ...(added === null ? { replace: true } : {}),
          ...(whole ? { message } : {}),
        };
        if (socket.event({ type: 'event', event: 'chat', payload })) socket.receipts.add(runId);
      }
    },
    hold: (method) => {
      holds.set(method, []);
      return () => {
        const waiting = holds.get(method) ?? [];
        holds.delete(method);
        for (const answer of waiting) answer();
      };
    },
    setHistory: (sessionKey, messages, inFlightRun) => {
      histories.set(sessionKey, { messages, ...(inFlightRun ? { inFlightRun } : {}) });
    },
    requestApproval: (kind, record) => {
      approvals[kind] = [...approvals[kind], record];
      engine.emit(`${kind}.approval.requested`, record);
    },
    resolveApproval: (id, decision, resolvedBy = 'Branch on the computer') => {
      if (!settle('exec', id, decision, resolvedBy)) settle('plugin', id, decision, resolvedBy);
    },
    pendingApprovals: (kind) => [...approvals[kind]],
    failMethod: (method, message, details, code) => {
      if (message === null) failures.delete(method);
      else failures.set(method, { message, ...(details === undefined ? {} : { details }), ...(code === undefined ? {} : { code }) });
    },
    approve: () => {
      decision = 'approved';
    },
    reject: () => {
      codeGone = true;
    },
    drop: () => {
      for (const socket of [...live]) socket.close(1012, 'engine restarting');
    },
    revoke: () => {
      revoked = true;
    },
    refuse: (next) => {
      if (next?.code === 'AUTH_BOOTSTRAP_TOKEN_INVALID') codeGone = true;
      refusal = next;
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
      const entry: Connection = {
        close,
        event: (frame) => {
          if (!helloSent) return false;
          engine.delivered.push({ event: frame.event, payload: frame.payload });
          reply(frame);
          return true;
        },
        receipts: new Set(),
        scopes: [],
        name: null,
      };
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
            const result = answer(frame.method, frame.params, entry);
            const respond = () =>
              reply(
                result.ok
                  ? { type: 'res', id: frame.id, ok: true, payload: result.payload }
                  : {
                      type: 'res',
                      id: frame.id,
                      ok: false,
                      error: { code: result.code ?? (result.details ? 'INVALID_REQUEST' : 'UNAVAILABLE'), message: result.message, ...(result.details ? { details: result.details } : {}) },
                    },
              );
            const held = holds.get(frame.method);
            if (held) held.push(respond);
            else respond();
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
          if (refusal) {
            reply({ type: 'res', id: frame.id, ok: false, error: { code: 'INVALID_REQUEST', message: refusal.message, details: { code: refusal.code } } });
            return;
          }
          if (params.auth?.deviceToken && (revoked || params.auth.deviceToken !== deviceToken)) {
            // The engine's words for this (engine/src/gateway/server/ws-connection/auth-messages.ts).
            const message = 'unauthorized: device token mismatch (rotate/reissue device token)';
            reply({ type: 'res', id: frame.id, ok: false, error: { code: 'INVALID_REQUEST', message, details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH' } } });
            return;
          }
          const knownDevice = params.auth?.deviceToken === deviceToken;
          const codeWorks = params.auth?.bootstrapToken === bootstrapToken && !codeGone;
          if (knownDevice || (codeWorks && decision === 'approved')) {
            helloSent = true;
            entry.scopes = params.scopes ?? [];
            entry.name = params.client.displayName ?? params.client.id;
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
          if (!codeWorks) {
            // The engine's words for this (engine/src/gateway/server/ws-connection/auth-messages.ts).
            const message = 'unauthorized: bootstrap token invalid or expired';
            reply({ type: 'res', id: frame.id, ok: false, error: { code: 'INVALID_REQUEST', message, details: { code: 'AUTH_BOOTSTRAP_TOKEN_INVALID' } } });
            return;
          }
          const details = { code: 'PAIRING_REQUIRED', requestId: 'request-1', reason: 'not-paired' };
          reply({ type: 'res', id: frame.id, ok: false, error: { code: 'NOT_PAIRED', message: 'pairing required', details } });
        },
      };
    },
  };
  return engine;
}
