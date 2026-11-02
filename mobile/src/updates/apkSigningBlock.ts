/**
 * APK Signing Block v2/v3/v3.1 certificate fingerprints. Same layout as
 * `ApkSigningBlockCerts.java` so Jest can cover the archive-cert read without Android.
 *
 * A present block that is truncated, empty, or malformed is unreadable: never a
 * partial cert list, and never a v1 fallback. v1 is only for archives with no
 * APK Signing Block at all.
 */
import { createHash } from 'node:crypto';

export const APK_SIG_BLOCK_MAGIC = Buffer.from('APK Sig Block 42', 'ascii');
export const V2_BLOCK_ID = 0x7109871a;
export const V3_BLOCK_ID = 0xf05368c0;
export const V31_BLOCK_ID = 0x1b93ad61;
const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const EOCD_MIN = 22;
const MAX_ZIP_COMMENT = 0xffff;
const ZIP64_MAGIC = 0xffffffff;

export type ArchiveCertRead =
  | { status: 'ok'; hex: string }
  | { status: 'absent' }
  | { status: 'unreadable' };

/** PackageManager / v1 signatures are allowed only when the archive has no APK Signing Block. */
export function allowV1Fallback(read: ArchiveCertRead): boolean {
  return read.status === 'absent';
}

export function readArchiveCert(bytes: Uint8Array): ArchiveCertRead {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cdOffset = centralDirectoryOffset(buf);
  if (cdOffset < 0) return { status: 'unreadable' };
  if (cdOffset < 24) return { status: 'absent' };
  const footer = buf.subarray(cdOffset - 24, cdOffset);
  if (!footer.subarray(8).equals(APK_SIG_BLOCK_MAGIC)) return { status: 'absent' };
  try {
    const pairs = signingBlockPairs(buf, cdOffset, footer);
    return certFromPairs(pairs);
  } catch {
    return { status: 'unreadable' };
  }
}

function certFromPairs(pairs: Buffer): ArchiveCertRead {
  let hex: string | undefined;
  let offset = 0;
  while (offset < pairs.length) {
    if (offset + 8 > pairs.length) throw new Error('truncated pair');
    const pairLen = Number(pairs.readBigUInt64LE(offset));
    offset += 8;
    if (pairLen < 4 || offset + pairLen > pairs.length) throw new Error('invalid pair length');
    const id = pairs.readUInt32LE(offset);
    const value = pairs.subarray(offset + 4, offset + pairLen);
    offset += Number(pairLen);
    if (id === V2_BLOCK_ID || id === V3_BLOCK_ID || id === V31_BLOCK_ID) {
      const next = firstCertOfSingleSigner(value);
      if (hex == null) hex = next;
      else if (hex !== next) throw new Error('conflicting signing schemes');
    }
  }
  if (hex == null) throw new Error('signing block has no v2/v3 signer');
  return { status: 'ok', hex };
}

function firstCertOfSingleSigner(schemeBlock: Buffer): string {
  const signers = lengthPrefixed(schemeBlock, 0);
  if (signers.next !== schemeBlock.length) throw new Error('extra bytes after signers');
  let pos = 0;
  let signerCount = 0;
  let firstHex: string | undefined;
  while (pos < signers.value.length) {
    const signer = lengthPrefixed(signers.value, pos);
    pos = signer.next;
    signerCount += 1;
    if (signerCount > 1) throw new Error('second signer');
    const signedData = lengthPrefixed(signer.value, 0);
    const digests = lengthPrefixed(signedData.value, 0);
    const certificates = lengthPrefixed(signedData.value, digests.next);
    let certPos = 0;
    let certCount = 0;
    while (certPos < certificates.value.length) {
      const cert = lengthPrefixed(certificates.value, certPos);
      certPos = cert.next;
      certCount += 1;
      if (certCount === 1) {
        if (cert.value.length === 0) throw new Error('empty certificate');
        firstHex = sha256Hex(cert.value);
      }
    }
    if (certCount < 1 || firstHex == null) throw new Error('no certificates');
  }
  if (signerCount !== 1 || firstHex == null) throw new Error('need one signer');
  return firstHex;
}

function signingBlockPairs(buf: Buffer, cdOffset: number, footer: Buffer): Buffer {
  const size = Number(footer.readBigUInt64LE(0));
  if (size < 24 || size > cdOffset - 8) throw new Error('invalid signing block size');
  const blockStart = cdOffset - size - 8;
  if (blockStart < 0) throw new Error('signing block underflow');
  if (Number(buf.readBigUInt64LE(blockStart)) !== size) throw new Error('signing block size mismatch');
  return buf.subarray(blockStart + 8, blockStart + 8 + (size - 24));
}

function centralDirectoryOffset(buf: Buffer): number {
  if (buf.length < EOCD_MIN) return -1;
  const maxTail = Math.min(buf.length, EOCD_MIN + MAX_ZIP_COMMENT);
  const tailStart = buf.length - maxTail;
  const tail = buf.subarray(tailStart);
  for (let comment = 0; comment <= MAX_ZIP_COMMENT; comment += 1) {
    const eocd = tail.length - EOCD_MIN - comment;
    if (eocd < 0) break;
    if (tail.readUInt32LE(eocd) !== EOCD_SIG) continue;
    if (tail.readUInt16LE(eocd + 20) !== comment) continue;
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === ZIP64_MAGIC) {
      return zip64CentralDirectoryOffset(buf, tailStart + eocd);
    }
    if (cdOffset > buf.length) return -1;
    return cdOffset;
  }
  return -1;
}

function zip64CentralDirectoryOffset(buf: Buffer, eocdOffset: number): number {
  if (eocdOffset < 20) return -1;
  const locator = buf.subarray(eocdOffset - 20, eocdOffset);
  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) return -1;
  const zip64Eocd = Number(locator.readBigUInt64LE(8));
  if (zip64Eocd < 0 || zip64Eocd + 56 > buf.length) return -1;
  if (buf.readUInt32LE(zip64Eocd) !== ZIP64_EOCD_SIG) return -1;
  return Number(buf.readBigUInt64LE(zip64Eocd + 48));
}

function lengthPrefixed(buf: Buffer, offset: number): { value: Buffer; next: number } {
  if (offset + 4 > buf.length) throw new Error('truncated length prefix');
  const len = buf.readUInt32LE(offset);
  const start = offset + 4;
  if (start + len > buf.length) throw new Error('invalid length prefix');
  return { value: buf.subarray(start, start + len), next: start + len };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function u16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n >>> 0);
  return buf;
}

function u64(n: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function len32(data: Buffer): Buffer {
  return Buffer.concat([u32(data.length), data]);
}

function schemeId(scheme?: 'v2' | 'v3' | 'v31'): number {
  if (scheme === 'v3') return V3_BLOCK_ID;
  if (scheme === 'v31') return V31_BLOCK_ID;
  return V2_BLOCK_ID;
}

function asSigners(certs?: Buffer[], signers?: Buffer[][]): Buffer[][] {
  if (signers) return signers;
  return [certs ?? []];
}

export function schemePair(id: number, signers: Buffer[][]): Buffer {
  const signerEntries = signers.map((certs) => {
    const certificates = len32(Buffer.concat(certs.map((cert) => len32(cert))));
    const digests = len32(Buffer.alloc(0));
    const attributes = len32(Buffer.alloc(0));
    const signedData = len32(Buffer.concat([digests, certificates, attributes]));
    const signatures = len32(Buffer.alloc(0));
    const publicKey = len32(Buffer.alloc(0));
    return len32(Buffer.concat([signedData, signatures, publicKey]));
  });
  const value = len32(Buffer.concat(signerEntries));
  return Buffer.concat([u64(4 + value.length), u32(id), value]);
}

export function apkWithSigningPairs(pairBufs: Buffer[]): Buffer {
  const pairs = Buffer.concat(pairBufs);
  const size = pairs.length + 24;
  const signingBlock = Buffer.concat([u64(size), pairs, u64(size), APK_SIG_BLOCK_MAGIC]);
  return zipAroundSigningBlock(signingBlock);
}

/** Minimal stored ZIP + APK Signing Block, for tests. Certificates need not be valid X.509. */
export function apkWithSigningCerts(options: {
  certs?: Buffer[];
  signers?: Buffer[][];
  scheme?: 'v2' | 'v3' | 'v31';
  extraScheme?: { id: number; certs?: Buffer[]; signers?: Buffer[][] };
}): Buffer {
  const pairs = [
    schemePair(schemeId(options.scheme), asSigners(options.certs, options.signers)),
  ];
  if (options.extraScheme) {
    pairs.push(schemePair(
      options.extraScheme.id,
      asSigners(options.extraScheme.certs, options.extraScheme.signers),
    ));
  }
  return apkWithSigningPairs(pairs);
}

/** Valid first pair, then a pairLen that overruns the block. */
export function apkWithTruncatedPairs(cert: Buffer): Buffer {
  const good = schemePair(V2_BLOCK_ID, [[cert]]);
  const truncated = Buffer.concat([u64(1000), u32(V2_BLOCK_ID)]);
  return apkWithSigningPairs([good, truncated]);
}

/** A v2 pair whose inner length prefix does not fit the value. */
export function apkWithMalformedScheme(): Buffer {
  const bogus = Buffer.from([0xff, 0xff, 0xff, 0x7f]);
  const pair = Buffer.concat([u64(4 + bogus.length), u32(V2_BLOCK_ID), bogus]);
  return apkWithSigningPairs([pair]);
}

export function apkWithEmptySigningBlock(): Buffer {
  const size = 24;
  const signingBlock = Buffer.concat([u64(size), u64(size), APK_SIG_BLOCK_MAGIC]);
  return zipAroundSigningBlock(signingBlock);
}

export function unsignedZip(): Buffer {
  return zipAroundSigningBlock(Buffer.alloc(0));
}

function zipAroundSigningBlock(signingBlock: Buffer): Buffer {
  const name = Buffer.from('a.txt');
  const data = Buffer.from('branch');
  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    name,
    data,
  ]);
  const cd = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name,
  ]);
  const cdOffset = local.length + signingBlock.length;
  const eocd = Buffer.concat([
    u32(EOCD_SIG),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(cd.length),
    u32(cdOffset),
    u16(0),
  ]);
  return Buffer.concat([local, signingBlock, cd, eocd]);
}
