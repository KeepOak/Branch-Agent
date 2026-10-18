/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  V3_BLOCK_ID,
  apkWithSigningCerts,
  sha256Hex,
  sha256HexesFromApk,
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

function nativeCerts(apk: Buffer): { hexes: string[]; status: number; stderr: string } {
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
      return { hexes: stdout.trim().split(/\n/).filter(Boolean), status: 0, stderr: '' };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return {
        hexes: String(err.stdout ?? '').trim().split(/\n/).filter(Boolean),
        status: err.status ?? 1,
        stderr: String(err.stderr ?? '').trim(),
      };
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
  it('reads the v2 signing-block certificate the same way from TypeScript and the native Java parser', () => {
    const apk = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v2' });
    expect(sha256HexesFromApk(apk)).toEqual([FINGERPRINT_A]);
    expect(nativeCerts(apk)).toEqual({ hexes: [FINGERPRINT_A], status: 0, stderr: '' });
  });

  it('reads v3 and v3.1 certificates, including when both v2 and v3 blocks are present', () => {
    const v3 = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v3' });
    const v31 = apkWithSigningCerts({ certs: [CERT_A], scheme: 'v31' });
    const both = apkWithSigningCerts({
      certs: [CERT_A],
      scheme: 'v2',
      extraScheme: { id: V3_BLOCK_ID, certs: [CERT_A] },
    });
    expect(sha256HexesFromApk(v3)).toEqual([FINGERPRINT_A]);
    expect(sha256HexesFromApk(v31)).toEqual([FINGERPRINT_A]);
    expect(sha256HexesFromApk(both)).toEqual([FINGERPRINT_A]);
    expect(nativeCerts(v3).hexes).toEqual([FINGERPRINT_A]);
    expect(nativeCerts(v31).hexes).toEqual([FINGERPRINT_A]);
    expect(nativeCerts(both).hexes).toEqual([FINGERPRINT_A]);
  });

  it('accepts an update whose v2 certificate matches the installed app', () => {
    const installed = sha256HexesFromApk(apkWithSigningCerts({ certs: [CERT_A], scheme: 'v2' }));
    const update = sha256HexesFromApk(apkWithSigningCerts({ certs: [CERT_A], scheme: 'v3' }));
    expect(certsMatch(installed, update)).toBe(true);
    expect(() => assertCertsMatch(installed, update)).not.toThrow();
  });

  it('refuses an update signed by a different certificate', () => {
    const installed = sha256HexesFromApk(apkWithSigningCerts({ certs: [CERT_A] }));
    const update = sha256HexesFromApk(apkWithSigningCerts({ certs: [CERT_B] }));
    expect(installed).toEqual([FINGERPRINT_A]);
    expect(update).toEqual([FINGERPRINT_B]);
    expect(certsMatch(installed, update)).toBe(false);
    expect(() => assertCertsMatch(installed, update)).toThrow(CERT_MISMATCH_MESSAGE);
  });

  it('treats a missing or unreadable signing block as unreadable, not as a match', () => {
    expect(sha256HexesFromApk(unsignedZip())).toEqual([]);
    expect(sha256HexesFromApk(Buffer.from('not-an-apk'))).toEqual([]);
    expect(sha256HexesFromApk(Buffer.alloc(0))).toEqual([]);
    expect(nativeCerts(unsignedZip())).toEqual({ hexes: [], status: 1, stderr: 'unreadable' });
    expect(nativeCerts(Buffer.from('not-an-apk'))).toEqual({ hexes: [], status: 1, stderr: 'unreadable' });
    expect(() => assertCertsMatch([FINGERPRINT_A], [])).toThrow(CERT_MISMATCH_MESSAGE);
  });

  it('keeps the native updater on the signing-block parser, then PackageManager, and still refuses empty certs', () => {
    const kt = readFileSync(kotlinSrc, 'utf8');
    const java = readFileSync(javaSrc, 'utf8');
    expect(kt.indexOf('ApkSigningBlockCerts.sha256Hexes')).toBeGreaterThan(-1);
    expect(kt.indexOf('ApkSigningBlockCerts.sha256Hexes')).toBeLessThan(kt.indexOf('archiveInfo('));
    expect(kt).toMatch(/GET_SIGNING_CERTIFICATES/);
    expect(kt).toMatch(/GET_SIGNATURES/);
    expect(kt).toContain(CERT_UNREADABLE_MESSAGE);
    expect(java).toContain('0x7109871a');
    expect(java).toContain('0xf05368c0');
    expect(java).toContain('0x1b93ad61');
  });
});
