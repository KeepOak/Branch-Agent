// BLAKE2b-512 (RFC 7693), unkeyed, 64-byte digest.
//
// Why this exists: Electron ships BoringSSL, which has no BLAKE2b, so
// node:crypto BLAKE2b-512 hashing throws "Digest method not supported"
// in the packaged app (#2104) while passing under plain Node/OpenSSL in CI.
// Minisign hashed ("ED") signatures need BLAKE2b-512.
//
// blake2b512() uses the native digest only when the runtime advertises it
// (getHashes()), and otherwise falls back to blake2b512Pure(): a 32-bit-limb
// implementation (no BigInt in the hot loop) that hashes 16 MiB in well
// under a second, so the Electron main thread is not frozen during Digest.
import * as nodeCrypto from "node:crypto";

const IV32 = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
const SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
]);

// v and m hold 64-bit words as [lo, hi] pairs of uint32.
const v = new Uint32Array(32);
const m = new Uint32Array(32);

function add64(a: number, b: number): void {
  const lo = v[a]! + v[b]!;
  v[a + 1] = v[a + 1]! + v[b + 1]! + (lo >= 0x100000000 ? 1 : 0);
  v[a] = lo;
}
function add64m(a: number, x: number): void {
  const lo = v[a]! + m[x]!;
  v[a + 1] = v[a + 1]! + m[x + 1]! + (lo >= 0x100000000 ? 1 : 0);
  v[a] = lo;
}

function G(a: number, b: number, c: number, d: number, ix: number, iy: number): void {
  let xl: number, xh: number;
  add64(a, b); add64m(a, ix);
  // d = rotr32(d ^ a)
  xl = v[d]! ^ v[a]!; xh = v[d + 1]! ^ v[a + 1]!; v[d] = xh; v[d + 1] = xl;
  add64(c, d);
  // b = rotr24(b ^ c)
  xl = v[b]! ^ v[c]!; xh = v[b + 1]! ^ v[c + 1]!;
  v[b] = (xl >>> 24) | (xh << 8); v[b + 1] = (xh >>> 24) | (xl << 8);
  add64(a, b); add64m(a, iy);
  // d = rotr16(d ^ a)
  xl = v[d]! ^ v[a]!; xh = v[d + 1]! ^ v[a + 1]!;
  v[d] = (xl >>> 16) | (xh << 16); v[d + 1] = (xh >>> 16) | (xl << 16);
  add64(c, d);
  // b = rotr63(b ^ c) = rotl1
  xl = v[b]! ^ v[c]!; xh = v[b + 1]! ^ v[c + 1]!;
  v[b] = (xh >>> 31) | (xl << 1); v[b + 1] = (xl >>> 31) | (xh << 1);
}

function compress(h: Uint32Array, buf: Uint8Array, off: number, tLo: number, tHi: number, last: boolean): void {
  for (let i = 0; i < 32; i++) {
    const p = off + i * 4;
    m[i] = buf[p]! | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24);
  }
  for (let i = 0; i < 16; i++) { v[i] = h[i]!; v[i + 16] = IV32[i]!; }
  v[24] = v[24]! ^ tLo; v[25] = v[25]! ^ tHi;
  if (last) { v[28] = ~v[28]!; v[29] = ~v[29]!; }
  for (let r = 0; r < 12; r++) {
    const s = (r % 10) * 16;
    G(0, 8, 16, 24, SIGMA[s]! * 2, SIGMA[s + 1]! * 2);
    G(2, 10, 18, 26, SIGMA[s + 2]! * 2, SIGMA[s + 3]! * 2);
    G(4, 12, 20, 28, SIGMA[s + 4]! * 2, SIGMA[s + 5]! * 2);
    G(6, 14, 22, 30, SIGMA[s + 6]! * 2, SIGMA[s + 7]! * 2);
    G(0, 10, 20, 30, SIGMA[s + 8]! * 2, SIGMA[s + 9]! * 2);
    G(2, 12, 22, 24, SIGMA[s + 10]! * 2, SIGMA[s + 11]! * 2);
    G(4, 14, 16, 26, SIGMA[s + 12]! * 2, SIGMA[s + 13]! * 2);
    G(6, 8, 18, 28, SIGMA[s + 14]! * 2, SIGMA[s + 15]! * 2);
  }
  for (let i = 0; i < 16; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 16]!;
}

/** Pure-JS BLAKE2b-512; identical to OpenSSL's blake2b512. Never uses node:crypto. */
export function blake2b512Pure(data: Uint8Array): Buffer {
  const h = IV32.slice();
  h[0] = h[0]! ^ 0x01010040; // digest length 64, no key, fanout=depth=1
  const len = data.length;
  let off = 0;
  let tLo = 0, tHi = 0;
  while (len - off > 128) {
    tLo += 128;
    if (tLo >= 0x100000000) { tLo -= 0x100000000; tHi++; }
    compress(h, data, off, tLo, tHi, false);
    off += 128;
  }
  const block = new Uint8Array(128);
  block.set(data.subarray(off));
  tLo += len - off;
  if (tLo >= 0x100000000) { tLo -= 0x100000000; tHi++; }
  compress(h, block, 0, tLo, tHi, true);
  const out = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) out.writeUInt32LE(h[i]! >>> 0, i * 4);
  return out;
}

let nativeOk: boolean | undefined;
/** True when node:crypto advertises BLAKE2b-512 (OpenSSL Node), false under Electron/BoringSSL. */
export function hasNativeBlake2b(): boolean {
  if (nativeOk === undefined) {
    try { nativeOk = nodeCrypto.getHashes().includes("blake2b512"); } catch { nativeOk = false; }
  }
  return nativeOk;
}

/** BLAKE2b-512 of `data`: native when the runtime has it, fast pure-JS otherwise (Electron). */
export function blake2b512(data: Uint8Array): Buffer {
  if (hasNativeBlake2b()) {
    try {
      return nodeCrypto.createHash(["blake", "2b512"].join("")).update(data).digest();
    } catch {
      nativeOk = false;
    }
  }
  return blake2b512Pure(data);
}
