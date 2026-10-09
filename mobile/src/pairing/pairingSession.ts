// Pairing and staying connected, as one small state machine the screens render. It owns the
// PhoneGateway, saves the computer's address once the engine approves this phone, and reconnects to it
// on the next launch with the device token the engine issued.
import { ConnectErrorDetailCodes, type GatewayBrowserDeviceIdentity, type HelloOk } from '@branch/gateway-client/browser';
import type { KeyValueStore } from '../storage/keyValueStore';
import { createDeviceTokenStore } from '../connect/deviceTokenStore';
import { OPERATOR_ROLE, PhoneGateway, phoneClient, type GatewayStatus, type PhoneGatewayOptions, type Platform } from '../connect/phoneGateway';
import { isGatewayUrl, type SetupPayload } from './setupCode';

export const PAIRING_RECORD_KEY = 'branch.pairing.v1';

export type PairingState =
  | { step: 'loading' }
  | { step: 'unpaired' }
  | { step: 'connecting'; url: string }
  /**
   * Waiting for Allow on the computer. `requestId` is the engine's pending request, whose check code the
   * computer shows; `expiresAtMs` is when the pairing code stops working.
   */
  | { step: 'approval'; url: string; requestId?: string; expiresAtMs?: number }
  | { step: 'paired'; url: string; online: boolean; serverVersion?: string }
  /** `canAskAgain`: the computer let the request run out, but the code still works, so it can be sent again. */
  | { step: 'failed'; url: string; message: string; canAskAgain?: boolean }
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

/** What the chat screens need from the connection: requests, pushed events, and each new handshake. */
export type EngineLink = {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Events from whichever connection is current, so a reconnect needs no new listener. */
  onEvent(listener: (event: string, payload: unknown) => void): () => void;
  /** Each finished handshake. Engine subscriptions belong to one connection, so readers subscribe again here. */
  onConnected(listener: (hello: HelloOk) => void): () => void;
  /** The open connection's handshake, or null while the computer can't be reached. */
  readonly hello: HelloOk | null;
};

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

/** The request ran out while it waited for Allow, in the words for when the code itself still works. */
export const ASK_AGAIN_MESSAGE =
  'Your computer didn’t let this phone in before the request ran out. The code still works, so you can ask again.';

/** The engine's codes for a pairing request or code that ran out or was spent. */
function ranOut(code: string | undefined): boolean {
  return code === ConnectErrorDetailCodes.PAIRING_EXPIRED || code === ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID;
}

/** Refusals that can clear up by themselves, so trying again makes sense. */
function canRetryAfter(code: string | undefined): boolean {
  return code === ConnectErrorDetailCodes.AUTH_RATE_LIMITED;
}

export class PairingSession implements EngineLink {
  private state: PairingState = { step: 'loading' };
  private readonly listeners = new Set<(state: PairingState) => void>();
  private readonly eventListeners = new Set<(event: string, payload: unknown) => void>();
  private readonly connectedListeners = new Set<(hello: HelloOk) => void>();
  private gateway: PhoneGateway | null = null;
  private paired: PairingRecord | null = null;
  private openHello: HelloOk | null = null;
  /** The code this pairing started from, so a request that ran out can be sent again with it. */
  private setup: SetupPayload | null = null;
  /** The code was already sent again once; a second refusal means it is spent, whatever its time says. */
  private askedAgain = false;

  constructor(private readonly deps: PairingDeps, private readonly now: () => number = Date.now) {}

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
    this.askedAgain = false;
    this.start(setup);
  }

  /**
   * After the computer let the request run out: sends it again with the same code, while the code still
   * works. Once only; a code turned away twice is spent.
   */
  askAgain(): void {
    const setup = this.setup;
    if (this.state.step !== 'failed' || !this.state.canAskAgain || !setup) return;
    this.askedAgain = true;
    this.start(setup);
  }

  private start(setup: SetupPayload): void {
    this.stopGateway();
    this.paired = null;
    this.setup = setup;
    this.set({ step: 'connecting', url: setup.url });
    this.connect(setup.url, setup.bootstrapToken);
  }

  /** Whether the code this pairing started from still works by its own expiry time. */
  private codeStillWorks(): boolean {
    const expires = this.setup?.expiresAtMs;
    return expires !== undefined && expires > this.now();
  }

  /** Stops a pairing that hasn't finished and goes back to the welcome. */
  cancel(): void {
    this.stopGateway();
    this.setup = null;
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
    this.eventListeners.clear();
    this.connectedListeners.clear();
  }

  get hello(): HelloOk | null {
    return this.openHello;
  }

  /** A fresh random id, for a message's idempotency key. */
  newId(): string {
    return this.deps.createRequestId();
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const gateway = this.gateway;
    if (!gateway || !this.openHello) return Promise.reject(new Error('Your computer isn’t connected right now.'));
    return gateway.request<T>(method, params);
  }

  onEvent(listener: (event: string, payload: unknown) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnected(listener: (hello: HelloOk) => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
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
    gateway.addEventListener((frame) => {
      if (this.gateway !== gateway) return;
      for (const listener of [...this.eventListeners]) listener(frame.event, frame.payload);
    });
    this.gateway = gateway;
    gateway.start();
  }

  private async onStatus(url: string, status: GatewayStatus): Promise<void> {
    if (status.phase !== 'connected') this.openHello = null;
    switch (status.phase) {
      case 'connecting':
        this.set(this.paired ? { step: 'paired', url, online: false } : { step: 'connecting', url });
        return;
      case 'pairing': {
        const expiresAtMs = this.setup?.expiresAtMs;
        this.set({ step: 'approval', url, ...(status.requestId ? { requestId: status.requestId } : {}), ...(expiresAtMs !== undefined ? { expiresAtMs } : {}) });
        return;
      }
      case 'connected': {
        if (!this.paired) {
          this.setup = null;
          this.paired = { version: 1, url, pairedAtMs: Date.now() };
          await this.deps.store.set(PAIRING_RECORD_KEY, JSON.stringify(this.paired));
        }
        this.openHello = status.hello;
        this.set({ step: 'paired', url, online: true, serverVersion: status.hello.server.version });
        for (const listener of [...this.connectedListeners]) listener(status.hello);
        return;
      }
      case 'failed':
        // PhoneGateway only reports 'failed' once the engine's reconnect policy has stopped retrying, so a
        // saved pairing that fails here will not come back by itself.
        if (this.paired) {
          this.set({ step: 'refused', url, message: failureMessage(status.code), canRetry: canRetryAfter(status.code) });
          return;
        }
        if (ranOut(status.code) && !this.askedAgain && this.codeStillWorks()) {
          this.set({ step: 'failed', url, message: ASK_AGAIN_MESSAGE, canAskAgain: true });
          return;
        }
        this.set({ step: 'failed', url, message: failureMessage(status.code) });
    }
  }

  private stopGateway(): void {
    const gateway = this.gateway;
    this.gateway = null;
    this.openHello = null;
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
