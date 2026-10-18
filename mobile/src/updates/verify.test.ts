import {
  CERT_MISMATCH_MESSAGE,
  CHECKSUM_MISMATCH_MESSAGE,
  assertCertsMatch,
  assertChecksum,
  certsMatch,
  checksumMatches,
  parseSha256Asset,
} from './verify';

const HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('checksum check', () => {
  it('reads the SHA-256 hex out of the usual sidecar shapes', () => {
    expect(parseSha256Asset(`${HEX}  branch-android-0.2.0.apk\n`)).toBe(HEX);
    expect(parseSha256Asset(`SHA256 (branch-android-0.2.0.apk) = ${HEX.toUpperCase()}`)).toBe(HEX);
    expect(parseSha256Asset(HEX)).toBe(HEX);
  });

  it('rejects a sidecar that is not a SHA-256 digest', () => {
    expect(() => parseSha256Asset('not-a-digest')).toThrow(/SHA-256/);
  });

  it('accepts a matching digest and refuses a mismatch', () => {
    expect(checksumMatches(HEX, HEX.toUpperCase())).toBe(true);
    expect(() => assertChecksum(HEX, HEX)).not.toThrow();
    expect(() => assertChecksum(HEX, '0'.repeat(64))).toThrow(CHECKSUM_MISMATCH_MESSAGE);
  });
});

describe('cert-mismatch rejection', () => {
  it('accepts an APK signed by a certificate this install already has', () => {
    expect(certsMatch(['aa', 'bb'], ['BB'])).toBe(true);
    expect(() => assertCertsMatch(['aa'], ['aa'])).not.toThrow();
  });

  it('refuses an APK whose signing certificate does not match the installed app', () => {
    expect(certsMatch(['aa'], ['bb'])).toBe(false);
    expect(() => assertCertsMatch(['aa'], ['bb'])).toThrow(CERT_MISMATCH_MESSAGE);
    expect(() => assertCertsMatch([], ['aa'])).toThrow(CERT_MISMATCH_MESSAGE);
    expect(() => assertCertsMatch(['aa'], [])).toThrow(CERT_MISMATCH_MESSAGE);
  });
});
