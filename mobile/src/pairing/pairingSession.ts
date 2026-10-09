// Pairing and staying connected, as one small state machine the screens render. It owns the
// PhoneGateway, saves the computer's address once the engine approves this phone, and reconnects to it
// on the next launch with the device token the engine issued.
import { ConnectErrorDetailCodes, type GatewayBrowserDeviceIdentity, type HelloOk } from '@branch/gateway-client/browser';
import type { KeyValueStore } from '../storage/keyValueStore';
import { createDeviceTokenStore } from '../connect/deviceTokenStore';
import { OPERATOR_ROLE, PhoneGateway, phoneClient, type GatewayStatus, type PhoneGatewayOptions, type Platform } from '../connect/phoneGateway';
import type { SetupPayload } from './setupCode';

export const PAIRING_RECORD_KEY = 'branch.pairing.v1';

export type PairingState =
  | { step: 'loading' }
  | { step: 'unpaired' }
  | { step: 'connecting'; url: string }
  | { step: 'approval'; url: string }
  | { step: 'paired'; url: string; online: boolean; serverVersion?: string }
  | { step: 'failed'; url: string; message: string };

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

/** Plain words for the ways a first pairing can end, keyed by the engine's connect error codes. */
export function failureMessage(status: Extract<GatewayStatus, { phase: 'failed' }>): string {
  switch (status.code) {
    case ConnectErrorDetailCodes.PAIRING_REJECTED:
      return 'Your computer turned this phone away. Pair again if that was a mistake.';
    case ConnectErrorDetailCodes.PAIRING_EXPIRED:
    case ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID:
      return 'This pairing code has expired or was already used. Make a new one on your computer and scan it again.';
    default:
      return `Your computer couldn't let this phone in: ${status.message}`;
  }
}

export class PairingSession implements EngineLink {
  private state: PairingState = { step: 'loading' };
  private readonly listeners = new Set<(state: PairingState) => void>();
  private readonly eventListeners = new Set<(event: string, payload: unknown) => void>();
  private readonly connectedListeners = new Set<(hello: HelloOk) => void>();
  private gateway: PhoneGateway | null = null;
  private paired: PairingRecord | null = null;
  private openHello: HelloOk | null = null;

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
      case 'pairing':
        this.set({ step: 'approval', url });
        return;
      case 'connected': {
        if (!this.paired) {
          this.paired = { version: 1, url, pairedAtMs: Date.now() };
          await this.deps.store.set(PAIRING_RECORD_KEY, JSON.stringify(this.paired));
        }
        this.openHello = status.hello;
        this.set({ step: 'paired', url, online: true, serverVersion: status.hello.server.version });
        for (const listener of [...this.connectedListeners]) listener(status.hello);
        return;
      }
      case 'failed':
        this.set(this.paired ? { step: 'paired', url, online: false } : { step: 'failed', url, message: failureMessage(status) });
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
      return value.version === 1 && typeof value.url === 'string' ? (value as PairingRecord) : null;
    } catch {
      return null;
    }
  }

  private set(state: PairingState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
