/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  V2_BLOCK_ID,
  V3_BLOCK_ID,
  allowV1Fallback,
  apkWithEmptySigningBlock,
  apkWithMalformedScheme,
  apkWithSigningCerts,
  apkWithTruncatedPairs,
  readArchiveCert,
  schemePair,
  sha256Hex,
  unsignedZip,
} from './apkSigningBlock';
import {
  CERT_MISMATCH_MESSAGE,
  CERT_UNREADABLE_MESSAGE,
  assertCertsMatch,
  certsMatch,
} from './verify';

const mobileRoot = path.join(__dirname, '../..');
const javaSrc = path.join(
  mobileRoot,
  'modules/apk-installer/android/src/main/java/expo/modules/apkinstaller/ApkSigningBlockCerts.java',
);
const kotlinSrc = path.join(
  mobileRoot,
  'modules/apk-installer/android/src/main/java/expo/modules/apkinstaller/ApkInstallerModule.kt',
);

const CERT_A = Buffer.from('branch-test-cert-a');
const CERT_B = Buffer.from('branch-test-cert-b');
const FINGERPRINT_A = sha256Hex(CERT_A);
const FINGERPRINT_B = sha256Hex(CERT_B);

let nativeClassesDir = '';

function nativeRead(apk: Buffer): { status: 'ok' | 'absent' | 'unreadable'; hex?: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'apk-sign-'));
  try {
    const apkPath = path.join(dir, 'fixture.apk');
    writeFileSync(apkPath, apk);
    try {
      const stdout = execFileSync(
        'java',
        ['-cp', nativeClassesDir, 'expo.modules.apkinstaller.ApkSigningBlockCerts', apkPath],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return { status: 'ok', hex: stdout.trim() };
    } catch (error) {
      const err = error as { stderr?: string };
      const stderr = String(err.stderr ?? '').trim();
      if (stderr === 'absent') return { status: 'absent' };
      return { status: 'unreadable' };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(() => {
  nativeClassesDir = mkdtempSync(path.join(tmpdir(), 'apk-sign-classes-'));
  execFileSync('javac', ['-encoding', 'UTF-8', '-d', nativeClassesDir, javaSrc], { stdio: 'pipe' });
});

afterAll(() => {
  if (nativeClassesDir) rmSync(nativeClassesDir, { recursive: true, force: true });
});

describe('APK Signing Block certificate fingerprints', () => {
  it('reads the single v2 signing-block certificate the same way from TypeScript and native Java', () => {
    const apk = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v2' });
    expect(readArchiveCert(apk)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(nativeRead(apk)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
  });

  it('reads v3 and v3.1, and accepts matching v2+v3 as one current cert', () => {
    const v3 = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v3' });
    const v31 = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v31' });
    const both = apkWithSigningCerts({
      certs: [CERT_A],
      scheme: 'v2',
      extraScheme: { id: V3_BLOCK_ID, certs: [CERT_A] },
    });
    expect(readArchiveCert(v3)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(readArchiveCert(v31)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(readArchiveCert(both)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(nativeRead(v3)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(nativeRead(v31)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(nativeRead(both)).toEqual({ status: 'ok', hex: FINGERPRINT_A });
  });

  it('accepts an update whose v2 certificate equals the installed app’s current certificate', () => {
    const installed = readArchiveCert(apkWithSigningCerts({ certs: [CERT_A], scheme: 'v2' }));
    const update = readArchiveCert(apkWithSigningCerts({ certs: [CERT_A], scheme: 'v3' }));
    expect(installed).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(update).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(certsMatch([FINGERPRINT_A], [FINGERPRINT_A])).toBe(true);
    expect(() => assertCertsMatch([FINGERPRINT_A], [FINGERPRINT_A])).not.toThrow();
  });

  it('refuses an update signed by a different certificate', () => {
    const installed = readArchiveCert(apkWithSigningCerts({ certs: [CERT_A] }));
    const update = readArchiveCert(apkWithSigningCerts({ certs: [CERT_B] }));
    expect(installed).toEqual({ status: 'ok', hex: FINGERPRINT_A });
    expect(update).toEqual({ status: 'ok', hex: FINGERPRINT_B });
    expect(certsMatch([FINGERPRINT_A], [FINGERPRINT_B])).toBe(false);
    expect(() => assertCertsMatch([FINGERPRINT_A], [FINGERPRINT_B])).toThrow(CERT_MISMATCH_MESSAGE);
  });

  it('treats a ZIP with no signing block as absent, so v1 fallback is allowed', () => {
    expect(readArchiveCert(unsignedZip())).toEqual({ status: 'absent' });
    expect(nativeRead(unsignedZip())).toEqual({ status: 'absent' });
    expect(allowV1Fallback(readArchiveCert(unsignedZip()))).toBe(true);
  });

  it('refuses a truncated pair list as unreadable instead of returning a partial cert', () => {
    const apk = apkWithTruncatedPairs(CERT_A);
    expect(readArchiveCert(apk)).toEqual({ status: 'unreadable' });
    expect(nativeRead(apk)).toEqual({ status: 'unreadable' });
    expect(allowV1Fallback(readArchiveCert(apk))).toBe(false);
  });

  it('refuses an empty or malformed signing block as unreadable and never falls back to v1', () => {
    const empty = apkWithEmptySigningBlock();
    const malformed = apkWithMalformedScheme();
    const conflicting = apkWithSigningCerts({
      certs: [CERT_A],
      extraScheme: { id: V3_BLOCK_ID, certs: [CERT_B] },
    });
    const garbage = Buffer.from('not-an-apk');
    expect(readArchiveCert(empty)).toEqual({ status: 'unreadable' });
    expect(nativeRead(empty)).toEqual({ status: 'unreadable' });
    expect(allowV1Fallback(readArchiveCert(empty))).toBe(false);
    expect(readArchiveCert(malformed)).toEqual({ status: 'unreadable' });
    expect(nativeRead(malformed)).toEqual({ status: 'unreadable' });
    expect(allowV1Fallback(readArchiveCert(malformed))).toBe(false);
    expect(readArchiveCert(conflicting)).toEqual({ status: 'unreadable' });
    expect(nativeRead(conflicting)).toEqual({ status: 'unreadable' });
    expect(readArchiveCert(garbage)).toEqual({ status: 'unreadable' });
    expect(nativeRead(garbage)).toEqual({ status: 'unreadable' });
    expect(allowV1Fallback(readArchiveCert(garbage))).toBe(false);
  });

  it('refuses a second signer instead of matching either certificate', () => {
    const apk = apkWithSigningCerts({ signers: [[CERT_A], [CERT_B]] });
    expect(readArchiveCert(apk)).toEqual({ status: 'unreadable' });
    expect(nativeRead(apk)).toEqual({ status: 'unreadable' });
    expect(() => assertCertsMatch([FINGERPRINT_A], [FINGERPRINT_A, FINGERPRINT_B])).toThrow(
      CERT_MISMATCH_MESSAGE,
    );
  });

  it('compares only the first certificate of the single signer, not a stuffed chain cert', () => {
    const stuffed = apkWithSigningCerts({ certs: [CERT_B, CERT_A] });
    expect(readArchiveCert(stuffed)).toEqual({ status: 'ok', hex: FINGERPRINT_B });
    expect(nativeRead(stuffed)).toEqual({ status: 'ok', hex: FINGERPRINT_B });
    expect(certsMatch([FINGERPRINT_A], [FINGERPRINT_B])).toBe(false);
    expect(() => assertCertsMatch([FINGERPRINT_A], [FINGERPRINT_B])).toThrow(CERT_MISMATCH_MESSAGE);
  });

  it('keeps native v1 / GET_SIGNATURES only for an absent signing block, and never uses cert history', () => {
    const kt = readFileSync(kotlinSrc, 'utf8');
    const java = readFileSync(javaSrc, 'utf8');
    const apkFnStart = kt.indexOf('AsyncFunction("apkSigningCerts")');
    const apkFn = kt.slice(apkFnStart, kt.indexOf('AsyncFunction("installApk")'));
    expect(apkFn).toContain('ApkSigningBlockCerts.read');
    expect(apkFn.indexOf('isUnreadable')).toBeGreaterThan(-1);
    expect(apkFn.indexOf('isUnreadable')).toBeLessThan(apkFn.indexOf('isAbsent'));
    expect(apkFn.indexOf('isAbsent')).toBeGreaterThan(-1);
    expect(apkFn.indexOf('isAbsent')).toBeLessThan(apkFn.indexOf('v1ArchiveInfo('));
    expect(apkFn).toContain(CERT_UNREADABLE_MESSAGE);
    expect(kt).toMatch(/private fun v1ArchiveInfo[\s\S]*GET_SIGNATURES/);
    expect(kt).not.toMatch(/signingCertificateHistory/);
    expect(kt).toMatch(/apkContentsSigners/);
    expect(java).toContain('0x7109871a');
    expect(java).toContain('0xf05368c0');
    expect(java).toContain('0x1b93ad61');
    expect(schemePair(V2_BLOCK_ID, [[CERT_A]]).length).toBeGreaterThan(8);
  });
});
