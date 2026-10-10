// Reads the pairing code the Branch app on the computer shows as a QR code (device.pair.setupCode).
// Same format and checks as the engine's decodePairingSetupCode (engine/src/pairing/setup-code.ts):
// base64url JSON, optionally behind the oc-pair:// prefix, with a gateway URL and a short-lived
// bootstrap token that the engine's own device pairing accepts once.
import { base64UrlToUtf8 } from '../connect/base64url';

export type SetupPayload = {
  url: string;
  urls?: string[];
  bootstrapToken: string;
  expiresAtMs?: number;
  tlsFingerprint?: string;
};

/**
 * Why a code was turned away. `damaged` is a Branch code that no longer reads, such as one with a character
 * added or lost in copying; `invalid` is anything else.
 */
export type SetupCodeProblem = 'invalid' | 'damaged' | 'expired';

const MESSAGES: Record<SetupCodeProblem, string> = {
  invalid: 'Invalid pairing setup code.',
  damaged: 'Damaged pairing setup code.',
  expired: 'Pairing setup code has expired.',
};

export class SetupCodeError extends Error {
  constructor(readonly kind: SetupCodeProblem) {
    super(MESSAGES[kind]);
  }
}

const PREFIX = 'oc-pair://';
const CODE = /^[A-Za-z0-9_-]+$/;
/** Every code starts as base64url JSON of an object, `{"`, which encodes to `eyJ`. */
const OBJECT_START = 'eyJ';
const SCHEME_WITHOUT_AUTHORITY = /^(?:https?|wss?):(?!\/\/)/i;
const MAX_URLS = 8;

/**
 * The engine's own address normalisation (parseNormalizedGatewayUrl in engine/src/pairing/setup-code.ts):
 * ws or wss, a host, no user name or password, the path kept, no query or fragment. The engine's decoder
 * only accepts an address that is already in this form, so this one does too. Expo installs a WHATWG
 * URL on native, so the parse matches the engine's Node URL.
 */
function canonicalGatewayUrl(raw: string): string | null {
  if (SCHEME_WITHOUT_AUTHORITY.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const protocol = parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol;
  if (protocol !== 'ws:' && protocol !== 'wss:') return null;
  if (!parsed.hostname) return null;
  const port = parsed.port ? `:${parsed.port}` : '';
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${protocol}//${parsed.hostname}${port}${path}`;
}

/** A gateway address exactly as the engine writes one into a pairing code. */
export function isGatewayUrl(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && canonicalGatewayUrl(candidate) === candidate;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function decodeSetupCode(input: string, nowMs: number = Date.now()): SetupPayload {
  // A code has no spaces, so any space, tab or line break came from copying (a wrapped line, a trailing
  // newline) and is dropped.
  const compact = input.replace(/\s+/g, '');
  const prefixed = compact.toLowerCase().startsWith(PREFIX);
  const code = prefixed ? compact.slice(PREFIX.length) : compact;
  // Text that has the prefix or a code's opening but no longer reads is a damaged copy, not some other text.
  const unreadable = () => new SetupCodeError(prefixed || code.includes(OBJECT_START) ? 'damaged' : 'invalid');
  if (!code || !CODE.test(code)) throw unreadable();

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlToUtf8(code));
  } catch {
    throw unreadable();
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new SetupCodeError('invalid');
  }
  const record = decoded as Record<string, unknown>;

  const url = nonEmpty(record.url);
  const bootstrapToken = nonEmpty(record.bootstrapToken);
  if (!url || !bootstrapToken || !isGatewayUrl(url)) throw new SetupCodeError('invalid');

  let urls: string[] | undefined;
  if (record.urls !== undefined) {
    const list = record.urls;
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > MAX_URLS ||
      list.some((candidate) => !isGatewayUrl(candidate))
    ) {
      throw new SetupCodeError('invalid');
    }
    urls = list as string[];
  }

  let expiresAtMs: number | undefined;
  if (record.expiresAtMs !== undefined) {
    const value = record.expiresAtMs;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new SetupCodeError('invalid');
    }
    if (value <= nowMs) throw new SetupCodeError('expired');
    expiresAtMs = value;
  }

  const tlsFingerprint = record.tlsFingerprint === undefined ? undefined : nonEmpty(record.tlsFingerprint);
  if (record.tlsFingerprint !== undefined && !tlsFingerprint) throw new SetupCodeError('invalid');

  return {
    url,
    ...(urls ? { urls } : {}),
    bootstrapToken,
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
    ...(tlsFingerprint ? { tlsFingerprint } : {}),
  };
}

/**
 * The computer's address as people read it: host and port only. Never the scheme, path, or any user name
 * or password in the address.
 */
export function gatewayHost(url: string): string {
  try {
    const host = new URL(url).host;
    if (host) return host;
  } catch {
    // Not an address; fall through to the plain name below.
  }
  return 'your computer';
}
