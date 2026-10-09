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

export class SetupCodeError extends Error {
  constructor(readonly kind: 'invalid' | 'expired') {
    super(kind === 'expired' ? 'Pairing setup code has expired.' : 'Invalid pairing setup code.');
  }
}

const PREFIX = 'oc-pair://';
const CODE = /^[A-Za-z0-9_-]+$/;
const GATEWAY_URL = /^wss?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;
const MAX_URLS = 8;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function decodeSetupCode(input: string, nowMs: number = Date.now()): SetupPayload {
  const trimmed = input.trim();
  const code = trimmed.toLowerCase().startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  if (!code || !CODE.test(code)) throw new SetupCodeError('invalid');

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlToUtf8(code));
  } catch {
    throw new SetupCodeError('invalid');
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new SetupCodeError('invalid');
  }
  const record = decoded as Record<string, unknown>;

  const url = nonEmpty(record.url);
  const bootstrapToken = nonEmpty(record.bootstrapToken);
  if (!url || !bootstrapToken || !GATEWAY_URL.test(url)) throw new SetupCodeError('invalid');

  let urls: string[] | undefined;
  if (record.urls !== undefined) {
    const list = record.urls;
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      list.length > MAX_URLS ||
      list.some((candidate) => typeof candidate !== 'string' || !GATEWAY_URL.test(candidate))
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

/** The computer's address as people read it: host and port, without the scheme. */
export function gatewayHost(url: string): string {
  return /^wss?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;
}
