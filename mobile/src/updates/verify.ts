const HEX64 = /\b[a-fA-F0-9]{64}\b/;

export const CHECKSUM_MISMATCH_MESSAGE =
  'This update didn’t match its checksum. Branch won’t install it.';
export const CHECKSUM_MISSING_MESSAGE = 'The checksum file from this release isn’t a SHA-256 digest.';
export const CERT_MISMATCH_MESSAGE =
  'This update isn’t signed the same way as the app on this phone. Branch won’t install it.';
export const CERT_UNREADABLE_MESSAGE =
  'Branch couldn’t read the update’s signing certificate.';

/** First 64-char hex in a `.sha256` sidecar (`<hex>  filename`, `SHA256 (…) = <hex>`, or the hex alone). */
export function parseSha256Asset(text: string): string {
  const match = HEX64.exec(text);
  if (!match) throw new Error(CHECKSUM_MISSING_MESSAGE);
  return match[0].toLowerCase();
}

export function checksumMatches(actual: string, expected: string): boolean {
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

export function assertChecksum(actual: string, expected: string): void {
  if (!checksumMatches(actual, expected)) throw new Error(CHECKSUM_MISMATCH_MESSAGE);
}

/** True when both sides are exactly one cert and those fingerprints are the same. */
export function certsMatch(installed: string[], apk: string[]): boolean {
  if (installed.length !== 1 || apk.length !== 1) return false;
  const current = installed[0].trim().toLowerCase();
  const update = apk[0].trim().toLowerCase();
  return Boolean(current) && current === update;
}

export function assertCertsMatch(installed: string[], apk: string[]): void {
  if (!certsMatch(installed, apk)) throw new Error(CERT_MISMATCH_MESSAGE);
}
