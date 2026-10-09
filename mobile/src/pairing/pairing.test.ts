import { loadDeviceIdentity, DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { bytesToBase64Url, utf8ToBytes } from '../connect/base64url';
import { createFakeEngine } from '../connect/fakeEngine';
import { PHONE_SCOPES } from '../connect/phoneGateway';
import { memoryStore } from '../storage/keyValueStore';
import { PAIRING_RECORD_KEY, PairingSession, type PairingState } from './pairingSession';
import { decodeSetupCode, gatewayHost, SetupCodeError } from './setupCode';

const encode = (value: unknown) => bytesToBase64Url(utf8ToBytes(JSON.stringify(value)));
const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const randomUUID = () => crypto.randomUUID();

function sessionWith(engine = createFakeEngine(), store = memoryStore()) {
  const session = new PairingSession({
    store,
    platform: 'ios',
    appVersion: '0.1.0',
    loadIdentity: () => loadDeviceIdentity(store, randomBytes),
    createRequestId: randomUUID,
    createSocket: engine.createSocket,
    pairingRetryMs: 20,
  });
  const states: PairingState[] = [];
  session.subscribe((state) => states.push(state));
  return { session, engine, store, states };
}

function until(session: PairingSession, test: (state: PairingState) => boolean): Promise<PairingState> {
  const now = session.getState();
  if (test(now)) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out in ${session.getState().step}`)), 3000);
    const off = session.subscribe((state) => {
      if (!test(state)) return;
      clearTimeout(timer);
      off();
      resolve(state);
    });
  });
}

describe('pairing code', () => {
  const payload = { url: 'ws://192.168.1.20:19031', bootstrapToken: 'boot-1', expiresAtMs: 2_000_000_000_000 };

  it('reads the code the computer shows, with or without the oc-pair:// prefix', () => {
    expect(decodeSetupCode(encode(payload), 1_000)).toEqual(payload);
    expect(decodeSetupCode(`  oc-pair://${encode(payload)} `, 1_000)).toEqual(payload);
    expect(gatewayHost(payload.url)).toBe('192.168.1.20:19031');
  });

  it('turns away anything that is not a Branch pairing code', () => {
    for (const bad of ['', 'hello world', encode({ url: 'https://example.com', bootstrapToken: 'x' }), encode({ url: 'ws://h' }), encode([1])]) {
      expect(() => decodeSetupCode(bad)).toThrow(SetupCodeError);
    }
    expect(() => decodeSetupCode(encode({ ...payload, urls: [] }))).toThrow('Invalid pairing setup code.');
  });

  it('says when a code has expired', () => {
    expect(() => decodeSetupCode(encode(payload), payload.expiresAtMs)).toThrow(new SetupCodeError('expired'));
  });
});

describe('pairing with the computer', () => {
  it('waits for approval, then saves the computer and the device token the engine issues', async () => {
    const { session, engine, store, states } = sessionWith();
    await session.restore();
    expect(session.getState()).toEqual({ step: 'unpaired' });

    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    await until(session, (s) => s.step === 'approval');

    const first = engine.connects[0];
    expect(first.client).toMatchObject({ id: 'branch-ios', mode: 'ui', platform: 'ios' });
    expect(first.role).toBe('operator');
    expect(first.scopes).toEqual([...PHONE_SCOPES]);
    expect(first.scopes).not.toContain('operator.admin');
    expect(first.auth).toEqual({ bootstrapToken: 'boot-1' });
    expect(engine.signaturesValid[0]).toBe(true);
    expect(store.dump()[PAIRING_RECORD_KEY]).toBeUndefined();

    engine.approve();
    const paired = await until(session, (s) => s.step === 'paired' && s.online);
    expect(paired).toEqual({ step: 'paired', url: 'ws://computer.local:19031', online: true, serverVersion: '2026.10.8' });
    expect(states.map((s) => s.step)).toEqual(expect.arrayContaining(['connecting', 'approval', 'paired']));
    expect(JSON.parse(store.dump()[PAIRING_RECORD_KEY])).toMatchObject({ version: 1, url: 'ws://computer.local:19031' });
    expect(Object.entries(store.dump()).some(([key, value]) => key.startsWith('branch.device-token.v1.') && value.includes('device-token-1'))).toBe(true);
    session.dispose();
  });

  it('reconnects on the next launch with the device token and no pairing code', async () => {
    const first = sessionWith();
    first.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    first.engine.approve();
    await until(first.session, (s) => s.step === 'paired' && s.online);
    first.session.dispose();

    const relaunch = sessionWith(first.engine, first.store);
    await relaunch.session.restore();
    expect(relaunch.states[0]).toEqual({ step: 'paired', url: 'ws://computer.local:19031', online: false });
    await until(relaunch.session, (s) => s.step === 'paired' && s.online);
    const last = first.engine.connects[first.engine.connects.length - 1];
    expect(last.auth).toEqual({ deviceToken: 'device-token-1' });
    expect(first.engine.signaturesValid.every(Boolean)).toBe(true);
    relaunch.session.dispose();
  });

  it('keeps one device key across launches', async () => {
    const store = memoryStore();
    const a = await loadDeviceIdentity(store, randomBytes);
    const b = await loadDeviceIdentity(store, randomBytes);
    expect(b.deviceId).toBe(a.deviceId);
    expect(a.deviceId).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(store.dump()[DEVICE_IDENTITY_KEY]).publicKey).toBe(a.publicKey);
  });

  it('explains a refusal and an expired code in plain words', async () => {
    const refused = sessionWith();
    refused.engine.reject();
    refused.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    expect(await until(refused.session, (s) => s.step === 'failed')).toMatchObject({ message: expect.stringContaining('turned this phone away') });
    refused.session.dispose();

    const stale = sessionWith();
    stale.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'old-code' });
    expect(await until(stale.session, (s) => s.step === 'failed')).toMatchObject({ message: expect.stringContaining('expired or was already used') });
    stale.session.dispose();
  });

  it('shows the computer as offline while it restarts, then online again', async () => {
    const { session, engine } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    await until(session, (s) => s.step === 'paired' && s.online);
    engine.drop();
    await until(session, (s) => s.step === 'paired' && !s.online);
    await until(session, (s) => s.step === 'paired' && s.online);
    session.dispose();
  });

  it('cancel stops asking the computer; unpair forgets it and its token', async () => {
    const pending = sessionWith();
    pending.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    await until(pending.session, (s) => s.step === 'approval');
    pending.session.cancel();
    expect(pending.session.getState()).toEqual({ step: 'unpaired' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(pending.engine.openSockets).toBe(0);

    const { session, engine, store } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    await until(session, (s) => s.step === 'paired' && s.online);
    await session.unpair();
    expect(session.getState()).toEqual({ step: 'unpaired' });
    expect(Object.keys(store.dump())).toEqual([DEVICE_IDENTITY_KEY]);
  });
});
