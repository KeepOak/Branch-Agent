import { loadDeviceIdentity, DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { bytesToBase64Url, utf8ToBytes } from '../connect/base64url';
import { createFakeEngine } from '../connect/fakeEngine';
import { PHONE_SCOPES } from '../connect/phoneGateway';
import { memoryStore } from '../storage/keyValueStore';
import { CODE_GONE_MESSAGE, DENIED_MESSAGE, failureMessage, NEUTRAL_FAILURE_MESSAGE, PAIRING_RECORD_KEY, PairingSession, type PairingState } from './pairingSession';
import { decodeSetupCode, gatewayHost, isGatewayUrl, SetupCodeError } from './setupCode';

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

  it('turns away an address with a user name or password in it, in url and in urls', () => {
    const withCredentials = 'ws://user:secret@computer.local:19031';
    expect(() => decodeSetupCode(encode({ ...payload, url: withCredentials }), 1_000)).toThrow(new SetupCodeError('invalid'));
    expect(() => decodeSetupCode(encode({ ...payload, url: 'ws://user@computer.local:19031' }), 1_000)).toThrow(new SetupCodeError('invalid'));
    expect(() => decodeSetupCode(encode({ ...payload, urls: [payload.url, withCredentials] }), 1_000)).toThrow(new SetupCodeError('invalid'));
    expect(() => decodeSetupCode(`oc-pair://${encode({ ...payload, url: withCredentials })}`, 1_000)).toThrow(new SetupCodeError('invalid'));
  });

  it('only accepts an address already in the form the engine writes, like the engine decoder', () => {
    for (const good of ['ws://192.168.1.20:19031', 'wss://branch.example.ts.net', 'ws://[fd00::1]:19031', 'ws://computer.local:19031/branch']) {
      expect(isGatewayUrl(good)).toBe(true);
      expect(decodeSetupCode(encode({ ...payload, url: good, urls: [good] }), 1_000).url).toBe(good);
    }
    for (const bad of [
      'WS://computer.local:19031',
      'ws://Computer.local:19031',
      'ws://computer.local:19031/',
      'ws://computer.local:80',
      'wss://computer.local:443',
      'ws://computer.local:19031?x=1',
      'ws://computer.local:19031#x',
      'ws://computer.local:99999',
      'ws:computer.local:19031',
      'ws:///computer.local',
      'http://computer.local:19031',
      'ftp://computer.local',
      'computer.local:19031',
      'ws://exa mple.local',
    ]) {
      expect(isGatewayUrl(bad)).toBe(false);
      expect(() => decodeSetupCode(encode({ ...payload, url: bad }), 1_000)).toThrow(SetupCodeError);
      expect(() => decodeSetupCode(encode({ ...payload, urls: [bad] }), 1_000)).toThrow(SetupCodeError);
    }
  });

  it('never shows a user name or password from an address', () => {
    expect(gatewayHost('ws://user:secret@computer.local:19031')).toBe('computer.local:19031');
    expect(gatewayHost('ws://user:secret@computer.local:19031/branch?token=x')).toBe('computer.local:19031');
    expect(gatewayHost('not an address user:secret@')).toBe('your computer');
  });

  it('drops spaces and line breaks a copy picked up, inside the code as well as around it', () => {
    const text = encode(payload);
    const wrapped = ` ${text.slice(0, 20)}\n${text.slice(20, 41)}\r\n ${text.slice(41)}\t\n`;
    expect(decodeSetupCode(wrapped, 1_000)).toEqual(payload);
    expect(decodeSetupCode(`oc-pair:// ${text}`, 1_000)).toEqual(payload);
  });

  it('calls a code with one stray or missing character damaged, not “not a Branch code”', () => {
    const text = encode(payload);
    for (const damaged of [`${text}x`, `${text.slice(0, 30)}k${text.slice(30)}`, `${text.slice(0, 30)}${text.slice(31)}`, `${text.slice(0, 30)}.${text.slice(30)}`, `oc-pair://${text}!`, `x${text}`]) {
      expect(() => decodeSetupCode(damaged, 1_000)).toThrow(new SetupCodeError('damaged'));
    }
    for (const other of ['hello world', 'https://example.com/pair', '1234']) {
      expect(() => decodeSetupCode(other, 1_000)).toThrow(new SetupCodeError('invalid'));
    }
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

  it('explains a Deny and a code that no longer works in plain words', async () => {
    const refused = sessionWith();
    refused.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 300_000 });
    await until(refused.session, (s) => s.step === 'approval');
    refused.engine.reject();
    expect(await until(refused.session, (s) => s.step === 'failed')).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: DENIED_MESSAGE });
    expect(DENIED_MESSAGE).toBe('Your computer said no.');
    refused.session.dispose();

    const stale = sessionWith();
    stale.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'old-code' });
    expect(await until(stale.session, (s) => s.step === 'failed')).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: CODE_GONE_MESSAGE });
    expect(CODE_GONE_MESSAGE).toBe('This code no longer works. Make a new one on your computer.');
    stale.session.dispose();
  });

  it('carries the engine’s request id and the code’s expiry while waiting for Allow', async () => {
    const { session } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 300_000 });
    const waiting = await until(session, (s) => s.step === 'approval');
    expect(waiting).toEqual({ step: 'approval', url: 'ws://computer.local:19031', requestId: 'request-1', expiresAtMs: expect.any(Number) });
    session.dispose();
  });

  it('a code whose record is gone stays gone: the same code again is turned away, and only a new code pairs', async () => {
    const { session, engine } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 300_000 });
    await until(session, (s) => s.step === 'approval');
    engine.refuse({ code: 'AUTH_BOOTSTRAP_TOKEN_INVALID', message: 'unauthorized: bootstrap token invalid or expired' });
    expect(await until(session, (s) => s.step === 'failed')).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: DENIED_MESSAGE });

    // Stopping the refusal doesn't bring the code back, as on the real engine.
    engine.refuse(null);
    engine.approve();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 300_000 });
    expect(await until(session, (s) => s.step === 'failed')).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: CODE_GONE_MESSAGE });
    expect(session).not.toHaveProperty('askAgain');
    session.dispose();
  });

  it('says the code no longer works, not that the computer said no, when the code ran out while it waited', async () => {
    let now = 1_000;
    const store = memoryStore();
    const engine = createFakeEngine();
    const session = new PairingSession(
      { store, platform: 'ios', appVersion: '0.1.0', loadIdentity: () => loadDeviceIdentity(store, randomBytes), createRequestId: randomUUID, createSocket: engine.createSocket, pairingRetryMs: 20 },
      () => now,
    );
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1', expiresAtMs: 2_000 });
    await until(session, (s) => s.step === 'approval');
    now = 2_000;
    engine.refuse({ code: 'AUTH_BOOTSTRAP_TOKEN_INVALID', message: 'unauthorized: bootstrap token invalid or expired' });
    expect(await until(session, (s) => s.step === 'failed')).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: failureMessage('AUTH_BOOTSTRAP_TOKEN_INVALID') });
    session.dispose();
  });

  it('ignores a saved computer whose address carries a user name or password', async () => {
    const store = memoryStore();
    await store.set(PAIRING_RECORD_KEY, JSON.stringify({ version: 1, url: 'ws://user:secret@computer.local:19031', pairedAtMs: 1 }));
    const { session, engine } = sessionWith(createFakeEngine(), store);
    await session.restore();
    expect(session.getState()).toEqual({ step: 'unpaired' });
    expect(engine.urls).toEqual([]);
    session.dispose();
  });

  it('says to pair again, and stops trying, when the computer revokes the saved device token', async () => {
    const first = sessionWith();
    first.session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    first.engine.approve();
    await until(first.session, (s) => s.step === 'paired' && s.online);
    first.session.dispose();
    first.engine.revoke();

    // Next launch: the saved token no longer works.
    const relaunch = sessionWith(first.engine, first.store);
    await relaunch.session.restore();
    const refused = await until(relaunch.session, (s) => s.step === 'refused');
    expect(refused).toEqual({
      step: 'refused',
      url: 'ws://computer.local:19031',
      message: expect.stringContaining('no longer recognises this phone'),
      canRetry: false,
    });
    expect(JSON.stringify(refused)).not.toMatch(/unauthorized|token|rotate/i);
    const connectsAtRefusal = first.engine.connects.length;
    expect(first.engine.connects[connectsAtRefusal - 1].auth).toEqual({ deviceToken: 'device-token-1' });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(first.engine.connects.length).toBe(connectsAtRefusal);
    expect(relaunch.session.getState().step).toBe('refused');

    // Pairing again forgets the dead token and the saved computer.
    await relaunch.session.unpair();
    expect(relaunch.session.getState()).toEqual({ step: 'unpaired' });
    expect(Object.keys(relaunch.store.dump())).toEqual([DEVICE_IDENTITY_KEY]);
    relaunch.session.dispose();
  });

  it('says to pair again when the token is revoked while connected, not that it is reconnecting', async () => {
    const { session, engine, states } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    await until(session, (s) => s.step === 'paired' && s.online);
    engine.revoke();
    engine.drop();
    expect(await until(session, (s) => s.step === 'refused')).toMatchObject({ message: expect.stringContaining('Pair again'), canRetry: false });
    expect(states[states.length - 1].step).toBe('refused');
    session.dispose();
  });

  it('explains a permissions change on a saved pairing in plain words', async () => {
    const { session, engine } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    await until(session, (s) => s.step === 'paired' && s.online);
    engine.refuse({ code: 'AUTH_SCOPE_MISMATCH', message: 'unauthorized: device token scope mismatch (re-pair or approve scope upgrade)' });
    engine.drop();
    const refused = await until(session, (s) => s.step === 'refused');
    expect(refused).toMatchObject({ message: 'Your computer changed what this phone is allowed to do. Pair again to pick up the new permissions.', canRetry: false });
    session.dispose();
  });

  it('lets a rate-limited saved pairing try again once the computer accepts sign-ins', async () => {
    const { session, engine } = sessionWith();
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    engine.approve();
    await until(session, (s) => s.step === 'paired' && s.online);
    engine.refuse({ code: 'AUTH_RATE_LIMITED', message: 'unauthorized: too many failed authentication attempts (retry later)' });
    engine.drop();
    expect(await until(session, (s) => s.step === 'refused')).toMatchObject({ message: expect.stringContaining('too many tries'), canRetry: true });
    engine.refuse(null);
    session.retry();
    await until(session, (s) => s.step === 'paired' && s.online);
    session.dispose();
  });

  it('never shows the engine’s own error text; an unmapped refusal gets neutral words', async () => {
    const secret = 'unauthorized: gateway password mismatch (set gateway.remote.password to hunter2 at C:\\Users\\owner\\.branch\\branch.json)';
    const { session, engine } = sessionWith();
    engine.refuse({ code: 'AUTH_PASSWORD_MISMATCH', message: secret });
    session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
    const failed = await until(session, (s) => s.step === 'failed');
    expect(failed).toEqual({ step: 'failed', url: 'ws://computer.local:19031', message: NEUTRAL_FAILURE_MESSAGE });
    expect(JSON.stringify(failed)).not.toMatch(/hunter2|Users|gateway\.remote|unauthorized/);
    session.dispose();

    expect(failureMessage('SOME_CODE_FROM_A_LATER_ENGINE')).toBe(NEUTRAL_FAILURE_MESSAGE);
    expect(failureMessage(undefined)).toBe(NEUTRAL_FAILURE_MESSAGE);
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
