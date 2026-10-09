// base64url helpers that run the same on Hermes, the web and Node, without Buffer or TextDecoder.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP: Record<string, number> = Object.fromEntries([...ALPHABET].map((char, index) => [char, index]));

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

export function base64UrlToBytes(input: string): Uint8Array {
  if (input.length % 4 === 1) throw new Error('Invalid base64url length');
  const out = new Uint8Array(Math.floor((input.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of input) {
    const digit = LOOKUP[char];
    if (digit === undefined) throw new Error('Invalid base64url character');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, index);
}

export function base64UrlToUtf8(input: string): string {
  const bytes = base64UrlToBytes(input);
  let escaped = '';
  for (const byte of bytes) escaped += '%' + byte.toString(16).padStart(2, '0');
  return decodeURIComponent(escaped);
}

export function utf8ToBytes(text: string): Uint8Array {
  const escaped = encodeURIComponent(text);
  const out: number[] = [];
  for (let i = 0; i < escaped.length; i += 1) {
    if (escaped[i] === '%') {
      out.push(Number.parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(escaped.charCodeAt(i));
    }
  }
  return Uint8Array.from(out);
}
