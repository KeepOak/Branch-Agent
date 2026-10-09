// A stand-in for the engine gateway's WebSocket, for tests and screenshots. It speaks the real wire
// protocol (connect.challenge, the connect request, hello-ok or a PAIRING_REQUIRED error) and checks the
// phone's Ed25519 signature over the engine's v3 device-auth payload, so the engine's own client code in
// PhoneGateway runs exactly as it would against a computer.
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
};

export function createFakeEngine(options: { version?: string; bootstrapToken?: string; deviceToken?: string } = {}): FakeEngine {
  const version = options.version ?? '2026.10.8';
  const bootstrapToken = options.bootstrapToken ?? 'boot-1';
  const deviceToken = options.deviceToken ?? 'device-token-1';
  let decision: 'pending' | 'approved' | 'rejected' = 'pending';
  const live = new Set<{ close: (code: number, reason: string) => void }>();
  const engine: FakeEngine = {
    connects: [],
    urls: [],
    signaturesValid: [],
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
      const entry = { close };
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
            reply({ type: 'res', id: frame.id, ok: true, payload: {} });
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
