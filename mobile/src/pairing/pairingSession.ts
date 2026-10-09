// Pairing and staying connected, as one small state machine the screens render. It owns the
// PhoneGateway, saves the computer's address once the engine approves this phone, and reconnects to it
// on the next launch with the device token the engine issued.
import { ConnectErrorDetailCodes, type GatewayBrowserDeviceIdentity } from '@branch/gateway-client/browser';
import type { KeyValueStore } from '../storage/keyValueStore';
import { createDeviceTokenStore } from '../connect/deviceTokenStore';
import { OPERATOR_ROLE, PhoneGateway, phoneClient, type GatewayStatus, type PhoneGatewayOptions, type Platform } from '../connect/phoneGateway';
import { isGatewayUrl, type SetupPayload } from './setupCode';

export const PAIRING_RECORD_KEY = 'branch.pairing.v1';

export type PairingState =
  | { step: 'loading' }
  | { step: 'unpaired' }
  | { step: 'connecting'; url: string }
  | { step: 'approval'; url: string }
  | { step: 'paired'; url: string; online: boolean; serverVersion?: string }
  | { step: 'failed'; url: string; message: string }
  /**
   * The computer this phone paired with turned it away for good (its device token was revoked or no
   * longer matches, its permissions changed, or too many tries). The engine's client has stopped
   * retrying, so the phone says why and offers to pair again instead of claiming it is reconnecting.
   */
  | { step: 'refused'; url: string; message: string; canRetry: boolean };

export type PairingDeps = {
  store: KeyValueStore;
  platform: Platform;
  appVersion: string;
  loadIdentity: () => Promise<GatewayBrowserDeviceIdentity>;
  createRequestId: () => string;
  createSocket?: PhoneGatewayOptions['createSocket'];
  pairingRetryMs?: number;
};

type PairingRecord = { version: 1; url: string; pairedAtMs: number };

/** What the phone says for any refusal it has no specific words for. Never the engine's own text. */
export const NEUTRAL_FAILURE_MESSAGE =
  'Your computer couldn’t let this phone in. Make a new pairing code in Branch on your computer and pair again.';

/**
 * Plain words for the ways the computer can turn this phone away, keyed by the engine's connect error
 * codes (ConnectErrorDetailCodes). The engine's message text is never shown: it is written for the
 * command line and can carry technical detail.
 */
export function failureMessage(code: string | undefined): string {
  switch (code) {
    case ConnectErrorDetailCodes.PAIRING_REJECTED:
      return 'Your computer turned this phone away. Pair again if that was a mistake.';
    case ConnectErrorDetailCodes.PAIRING_EXPIRED:
    case ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID:
      return 'This pairing code has expired or was already used. Make a new one on your computer and scan it again.';
    case ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH:
    case ConnectErrorDetailCodes.DEVICE_IDENTITY_REQUIRED:
    case ConnectErrorDetailCodes.DEVICE_AUTH_INVALID:
    case ConnectErrorDetailCodes.DEVICE_AUTH_DEVICE_ID_MISMATCH:
    case ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_INVALID:
    case ConnectErrorDetailCodes.DEVICE_AUTH_PUBLIC_KEY_INVALID:
      return 'Your computer no longer recognises this phone. It may have been removed from Branch on your computer. Pair again to keep using it here.';
    case ConnectErrorDetailCodes.AUTH_SCOPE_MISMATCH:
      return 'Your computer changed what this phone is allowed to do. Pair again to pick up the new permissions.';
    case ConnectErrorDetailCodes.AUTH_RATE_LIMITED:
      return 'Your computer paused sign-ins after too many tries. Wait a minute, then try again.';
    case ConnectErrorDetailCodes.PROTOCOL_MISMATCH:
    case ConnectErrorDetailCodes.CLIENT_VERSION_MISMATCH:
      return 'This phone and your computer are on different versions of Branch. Update Branch on both, then open it again.';
    default:
      return NEUTRAL_FAILURE_MESSAGE;
  }
}

/** Refusals that can clear up by themselves, so trying again makes sense. */
function canRetryAfter(code: string | undefined): boolean {
  return code === ConnectErrorDetailCodes.AUTH_RATE_LIMITED;
}

export class PairingSession {
  private state: PairingState = { step: 'loading' };
  private readonly listeners = new Set<(state: PairingState) => void>();
  private gateway: PhoneGateway | null = null;
  private paired: PairingRecord | null = null;

  constructor(private readonly deps: PairingDeps) {}

  getState(): PairingState {
    return this.state;
  }

  subscribe(listener: (state: PairingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** On launch: reconnect to the computer this phone paired with, or show the welcome. */
  async restore(): Promise<void> {
    const record = this.readRecord(await this.deps.store.get(PAIRING_RECORD_KEY));
    this.paired = record;
    if (!record) {
      this.set({ step: 'unpaired' });
      return;
    }
    this.set({ step: 'paired', url: record.url, online: false });
    this.connect(record.url);
  }

  /** Starts pairing with the computer named in a scanned or typed pairing code. */
  begin(setup: SetupPayload): void {
    this.stopGateway();
    this.paired = null;
    this.set({ step: 'connecting', url: setup.url });
    this.connect(setup.url, setup.bootstrapToken);
  }

  /** Stops a pairing that hasn't finished and goes back to the welcome. */
  cancel(): void {
    this.stopGateway();
    if (!this.paired) this.set({ step: 'unpaired' });
  }

  /** After the computer refused a saved pairing for a reason that can clear up: ask it again. */
  retry(): void {
    const record = this.paired;
    if (!record || this.state.step !== 'refused') return;
    this.stopGateway();
    this.set({ step: 'paired', url: record.url, online: false });
    this.connect(record.url);
  }

  /** Forgets the computer: closes the connection and deletes its address and device token here. */
  async unpair(): Promise<void> {
    const record = this.paired;
    this.stopGateway();
    this.paired = null;
    if (record) {
      const identity = await this.deps.loadIdentity();
      await createDeviceTokenStore(this.deps.store, record.url).clear({
        clientId: phoneClient(this.deps.platform, this.deps.appVersion).id,
        deviceId: identity.deviceId,
        role: OPERATOR_ROLE,
      });
    }
    await this.deps.store.remove(PAIRING_RECORD_KEY);
    this.set({ step: 'unpaired' });
  }

  dispose(): void {
    this.stopGateway();
    this.listeners.clear();
  }

  private connect(url: string, bootstrapToken?: string): void {
    const gateway = new PhoneGateway({
      url,
      platform: this.deps.platform,
      appVersion: this.deps.appVersion,
      bootstrapToken,
      loadIdentity: this.deps.loadIdentity,
      tokenStore: createDeviceTokenStore(this.deps.store, url),
      createRequestId: this.deps.createRequestId,
      createSocket: this.deps.createSocket,
      pairingRetryMs: this.deps.pairingRetryMs,
      onStatus: (status) => {
        if (this.gateway === gateway) void this.onStatus(url, status);
      },
    });
    this.gateway = gateway;
    gateway.start();
  }

  private async onStatus(url: string, status: GatewayStatus): Promise<void> {
    switch (status.phase) {
      case 'connecting':
        this.set(this.paired ? { step: 'paired', url, online: false } : { step: 'connecting', url });
        return;
      case 'pairing':
        this.set({ step: 'approval', url });
        return;
      case 'connected': {
        if (!this.paired) {
          this.paired = { version: 1, url, pairedAtMs: Date.now() };
          await this.deps.store.set(PAIRING_RECORD_KEY, JSON.stringify(this.paired));
        }
        this.set({ step: 'paired', url, online: true, serverVersion: status.hello.server.version });
        return;
      }
      case 'failed':
        // PhoneGateway only reports 'failed' once the engine's reconnect policy has stopped retrying, so a
        // saved pairing that fails here will not come back by itself.
        this.set(
          this.paired
            ? { step: 'refused', url, message: failureMessage(status.code), canRetry: canRetryAfter(status.code) }
            : { step: 'failed', url, message: failureMessage(status.code) },
        );
    }
  }

  private stopGateway(): void {
    const gateway = this.gateway;
    this.gateway = null;
    gateway?.stop();
  }

  private readRecord(raw: string | null): PairingRecord | null {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as Partial<PairingRecord>;
      return value.version === 1 && isGatewayUrl(value.url) ? (value as PairingRecord) : null;
    } catch {
      return null;
    }
  }

  private set(state: PairingState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
