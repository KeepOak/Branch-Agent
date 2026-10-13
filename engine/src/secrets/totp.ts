// Copied from Skyvern-AI/skyvern@4a3ca3abccf831250f81b01f741b571564249bc4:skyvern/forge/sdk/services/credentials.py (atlas INTEGRATIONS-0064)
/**
 * TOTP verification codes from a raw Base32 seed or a full otpauth:// URI.
 *
 * Mirrors skyvern's credential TOTP helpers, with pyotp's parse_uri and
 * RFC 6238 generation written out in TypeScript. An invalid seed is discarded
 * and never echoed into logs or errors.
 */

import { createHmac } from "node:crypto";

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

export type TotpConfig = {
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
};

const SECRET_QUERY_PATTERN = /(?:^|[?&])secret=([^&#]+)/i;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VALID_PADDING_COUNTS = new Set([0, 1, 3, 4, 6]);
const URI_ALGORITHMS: Record<string, TotpAlgorithm> = {
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
};

type SplitUri = { scheme: string; netloc: string; path: string; query: string };

function stripTotpInputWhitespace(totpSecret: string): string {
  return totpSecret.split(/\s+/).join("");
}

function compactSecretValue(totpSecret: string): string {
  return stripTotpInputWhitespace(totpSecret).replaceAll("-", "");
}

/** Python's unquote: decode percent escapes, leaving malformed ones in place. */
function unquote(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** urlsplit equivalent: only an unbalanced IPv6 bracket in the authority fails. */
function safeUrlSplit(value: string): SplitUri | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/.exec(value);
  if (!match) {
    return { scheme: "", netloc: "", path: value, query: "" };
  }
  const netloc = match[2] ?? "";
  if (netloc.includes("[") !== netloc.includes("]")) {
    return null;
  }
  return { scheme: match[1] ?? "", netloc, path: match[3] ?? "", query: match[4] ?? "" };
}

function isOtpauthTotpUri(value: string): boolean {
  const parsed = safeUrlSplit(value);
  return parsed?.scheme.toLowerCase() === "otpauth" && parsed.netloc.toLowerCase() === "totp";
}

/** parse_qsl without keep_blank_values: blank values and bare keys are dropped. */
function parseQueryPairs(query: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const field of query.split("&")) {
    const equals = field.indexOf("=");
    if (equals < 0) {
      continue;
    }
    const value = unquote(field.slice(equals + 1).replaceAll("+", " "));
    if (value) {
      pairs.push([unquote(field.slice(0, equals).replaceAll("+", " ")), value]);
    }
  }
  return pairs;
}

/** pyotp byte_secret: Base32 with implied padding, case-insensitive. */
export function decodeBase32Secret(secret: string): Buffer | null {
  const missingPadding = secret.length % 8;
  const padded = missingPadding ? secret + "=".repeat(8 - missingPadding) : secret;
  const match = /^([A-Za-z2-7]*)(=*)$/.exec(padded);
  if (!match || !VALID_PADDING_COUNTS.has(match[2]?.length ?? 0)) {
    return null;
  }
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of (match[1] ?? "").toUpperCase()) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function validateBase32Secret(totpSecret: string): string {
  const normalized = compactSecretValue(totpSecret);
  return decodeBase32Secret(normalized) ? normalized : "";
}

function parseUriInteger(value: string): number | null {
  const trimmed = value.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

type UriFields = { secret?: string; algorithm?: TotpAlgorithm; digits?: number; period?: number };

function applyUriParameter(fields: UriFields, key: string, value: string): boolean {
  switch (key) {
    case "secret":
      fields.secret = value;
      return true;
    case "algorithm":
      fields.algorithm = URI_ALGORITHMS[value];
      return fields.algorithm !== undefined;
    case "digits":
      fields.digits = parseUriInteger(value) ?? Number.NaN;
      return [6, 7, 8].includes(fields.digits);
    case "period":
      fields.period = parseUriInteger(value) ?? Number.NaN;
      return Number.isFinite(fields.period);
    case "issuer":
    case "image":
    case "encoder":
      return key !== "encoder" || value !== "steam";
    default:
      return false;
  }
}

/**
 * Parse an otpauth://totp URI. Issuer metadata never affects code generation,
 * so a label/query issuer mismatch is ignored (as skyvern recovers from
 * pyotp's mismatch error), but a duplicated issuer parameter is rejected.
 */
function parseUriTotp(uri: string): TotpConfig | null {
  const parsed = safeUrlSplit(unquote(uri));
  if (!parsed || parsed.scheme !== "otpauth" || parsed.netloc.toLowerCase() !== "totp") {
    return null;
  }
  const pairs = parseQueryPairs(parsed.query);
  if (pairs.filter(([key]) => key === "issuer").length > 1) {
    return null;
  }
  const fields: UriFields = {};
  for (const [key, value] of pairs) {
    if (!applyUriParameter(fields, key, value)) {
      return null;
    }
  }
  const period = fields.period ?? 30;
  if (!fields.secret || period <= 0 || !decodeBase32Secret(fields.secret)) {
    return null;
  }
  return {
    secret: fields.secret,
    algorithm: fields.algorithm ?? "sha1",
    digits: fields.digits ?? 6,
    period,
  };
}

function uriCandidates(normalizedInput: string): string[] {
  const unquoted = unquote(normalizedInput);
  return unquoted === normalizedInput ? [normalizedInput] : [normalizedInput, unquoted];
}

/** Return the validated Base32 seed from a raw seed, otpauth URI or secret= URL; "" when invalid. */
export function parseTotpSecret(totpSecret: string): string {
  if (!totpSecret) {
    return "";
  }
  const stripped = totpSecret.trim();
  const validated = validateBase32Secret(stripped);
  if (validated) {
    return validated;
  }
  const normalizedInput = stripTotpInputWhitespace(stripped);
  for (const candidate of uriCandidates(normalizedInput)) {
    const parsed = safeUrlSplit(candidate);
    if (!parsed) {
      return "";
    }
    if (parsed.scheme.toLowerCase() !== "otpauth" || parsed.netloc.toLowerCase() !== "totp") {
      if (parsed.scheme.toLowerCase() === "otpauth") {
        return "";
      }
      continue;
    }
    const config = parseUriTotp(candidate);
    return config ? validateBase32Secret(config.secret) : "";
  }
  const match = SECRET_QUERY_PATTERN.exec(unquote(normalizedInput));
  return match?.[1] ? validateBase32Secret(match[1]) : "";
}

function otpauthUriInput(totpSecret: string): string | null {
  const noWhitespace = stripTotpInputWhitespace(totpSecret);
  if (isOtpauthTotpUri(noWhitespace)) {
    return noWhitespace;
  }
  const unquoted = unquote(noWhitespace);
  return unquoted !== noWhitespace && isOtpauthTotpUri(unquoted) ? unquoted : null;
}

/** Parse a raw Base32 TOTP secret or full otpauth URI into a TOTP config. */
export function parseTotpConfig(totpSecret: string): TotpConfig | null {
  if (!totpSecret) {
    return null;
  }
  const uri = otpauthUriInput(totpSecret);
  if (uri) {
    return parseUriTotp(uri);
  }
  const secret = parseTotpSecret(totpSecret);
  return secret ? { secret, algorithm: "sha1", digits: 6, period: 30 } : null;
}

/** Return the validated config string while preserving otpauth URI parameters. */
export function normalizeTotpConfig(totpSecret: string): string {
  if (!totpSecret) {
    return "";
  }
  const uri = otpauthUriInput(totpSecret);
  if (uri) {
    return parseTotpConfig(uri) ? uri : "";
  }
  return parseTotpSecret(totpSecret);
}

function hotp(config: TotpConfig, counter: number): string {
  const key = decodeBase32Secret(config.secret);
  if (!key) {
    throw new Error("Invalid TOTP secret or otpauth URI");
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(config.algorithm, key).update(message).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(code % 10 ** config.digits).padStart(config.digits, "0");
}

/** Generate the code for a raw TOTP secret or full otpauth URI (default: now). */
export function generateTotpCode(totpSecret: string, forTime?: number): string {
  const config = parseTotpConfig(totpSecret);
  if (!config) {
    throw new Error("Invalid TOTP secret or otpauth URI");
  }
  const seconds = Math.trunc(forTime ?? Date.now() / 1000);
  return hotp(config, Math.floor(seconds / config.period));
}

/**
 * Seconds to wait before generating so the code keeps at least
 * `minRemainingSeconds` of its step (capped one second short of the step);
 * 0 when it already would.
 */
export function totpWindowWaitSeconds(
  totpSecret: string,
  minRemainingSeconds: number,
  now: number,
): number {
  if (minRemainingSeconds <= 0) {
    return 0;
  }
  const config = parseTotpConfig(totpSecret);
  if (!config) {
    return 0;
  }
  const threshold = Math.max(0, Math.min(minRemainingSeconds, config.period - 1));
  const remaining = config.period - (now % config.period);
  return remaining < threshold ? remaining : 0;
}

export async function waitForFreshTotpWindow(
  totpSecret: string,
  options: {
    minRemainingSeconds?: number;
    now?: () => number;
    sleep?: (seconds: number) => Promise<void>;
  } = {},
): Promise<void> {
  const now = options.now ?? (() => Date.now() / 1000);
  const sleep =
    options.sleep ??
    ((seconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, seconds * 1000);
      }));
  // Re-measured after each sleep: a late wake can land in the next window's
  // tail. Bounded, because a wait always ends at a window boundary.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waitSeconds = totpWindowWaitSeconds(totpSecret, options.minRemainingSeconds ?? 0, now());
    if (waitSeconds <= 0) {
      return;
    }
    await sleep(waitSeconds);
  }
}
