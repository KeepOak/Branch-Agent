// A PairingSession wired to the in-memory store and the fake engine, for tests.
import { loadDeviceIdentity } from '../connect/deviceIdentity';
import { createFakeEngine, type FakeEngine } from '../connect/fakeEngine';
import type { PhoneReconnect } from '../connect/phoneGateway';
import { memoryStore } from '../storage/keyValueStore';
import { PairingSession } from '../pairing/pairingSession';

export function createFakeSession(engine: FakeEngine = createFakeEngine(), store?: ReturnType<typeof memoryStore>, opts: { reconnect?: PhoneReconnect } = {}) {
  const used = store ?? memoryStore();
  const session = new PairingSession({
    store: used,
    platform: 'ios',
    appVersion: '0.1.0',
    loadIdentity: () => loadDeviceIdentity(used, (length) => crypto.getRandomValues(new Uint8Array(length))),
    createRequestId: () => crypto.randomUUID(),
    createSocket: engine.createSocket,
    pairingRetryMs: 20,
    ...(opts.reconnect ? { reconnect: opts.reconnect } : {}),
  });
  return { session, engine, store: used };
}
