// A PairingSession wired to the in-memory store and the fake engine, for tests.
import { loadDeviceIdentity } from '../connect/deviceIdentity';
import { createFakeEngine, type FakeEngine } from '../connect/fakeEngine';
import { memoryStore } from '../storage/keyValueStore';
import { PairingSession } from '../pairing/pairingSession';

export function createFakeSession(engine: FakeEngine = createFakeEngine(), store = memoryStore()) {
  const session = new PairingSession({
    store,
    platform: 'ios',
    appVersion: '0.1.0',
    loadIdentity: () => loadDeviceIdentity(store, (length) => crypto.getRandomValues(new Uint8Array(length))),
    createRequestId: () => crypto.randomUUID(),
    createSocket: engine.createSocket,
    pairingRetryMs: 20,
  });
  return { session, engine, store };
}
