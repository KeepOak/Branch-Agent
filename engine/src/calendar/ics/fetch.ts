/**
 * Bounded conditional fetch for capability-bearing ICS subscription URLs.
 *
 * Every hop goes through the shared pinned-DNS SSRF guard. Public results
 * expose only an origin and SHA-256 fingerprint; callers keep the full URL.
 */

import { createHash } from "node:crypto";
import { fetchWithSsrFGuard, type GuardedFetchOptions } from "../../infra/net/fetch-guard.js";
import { IcsError, type IcsErrorSeverity } from "./errors.js";
import type { IcsFetchResult, IcsFetchValidators } from "./types.js";

export const MAX_ICS_FEED_BYTES = 5 * 1024 * 1024;
const ICS_FETCH_TIMEOUT_MS = 15_000;
const MAX_ICS_REDIRECTS = 5;
const MAX_SOURCE_URL_LENGTH = 4096;

export type IcsFetchTransport = Pick<GuardedFetchOptions, "fetchImpl" | "lookupFn">;

function fetchError(
  code: string,
  message: string,
  context: Record<string, unknown>,
  severity: IcsErrorSeverity = "fatal",
): never {
  throw new IcsError(message, { code, context, severity });
}

function safeValidator(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/[\r\n]/.test(value)) {
    fetchError(
      "ICS_INVALID_HTTP_VALIDATOR",
      "Calendar feed validator contains forbidden control characters.",
      {},
    );
  }
  return value;
}

function parseSourceUrl(normalized: string): URL {
  try {
    return new URL(normalized);
  } catch (error) {
    throw new IcsError("Calendar source URL is invalid.", {
      code: "ICS_INVALID_SOURCE_URL",
      cause: error,
      severity: "fatal",
    });
  }
}

export function normalizeIcsSourceUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_SOURCE_URL_LENGTH) {
    return fetchError(
      "ICS_INVALID_SOURCE_URL",
      "Calendar source URL is empty or above the length limit.",
      { maxLength: MAX_SOURCE_URL_LENGTH },
    );
  }
  const parsed = parseSourceUrl(trimmed.replace(/^webcal:/i, "https:"));
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return fetchError(
      "ICS_INVALID_SOURCE_PROTOCOL",
      "Calendar source URL must use webcal, HTTPS, or HTTP.",
      { protocol: parsed.protocol },
    );
  }
  if (parsed.username || parsed.password) {
    return fetchError(
      "ICS_SOURCE_USERINFO_FORBIDDEN",
      "Calendar source URL cannot embed username or password credentials.",
      { origin: parsed.origin },
    );
  }
  parsed.hash = "";
  return parsed;
}

export function fingerprintIcsSourceUrl(url: URL): string {
  return createHash("sha256").update(url.href).digest("hex");
}

function assertDeclaredLength(response: Response, sourceFingerprint: string): void {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_ICS_FEED_BYTES
  ) {
    fetchError("ICS_FEED_TOO_LARGE", "Calendar feed exceeds the response-size limit.", {
      sourceFingerprint,
      limit: MAX_ICS_FEED_BYTES,
    });
  }
}

function decodeChunk(
  decoder: TextDecoder,
  sourceFingerprint: string,
  value?: Uint8Array,
  stream = false,
): string {
  try {
    return decoder.decode(value, { stream });
  } catch (error) {
    // Preserve the decoder failure and add only the opaque source identity;
    // capability-bearing URLs never enter the error chain.
    throw new IcsError("Calendar feed body is not valid UTF-8.", {
      code: "ICS_FEED_INVALID_UTF8",
      context: { sourceFingerprint },
      cause: error,
      severity: "fatal",
    });
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sourceFingerprint: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch (error) {
    // Preserve transport/read failures with a redacted source fingerprint so
    // they are not mislabeled as parse failures.
    throw new IcsError("Calendar feed body read failed.", {
      code: "ICS_FEED_BODY_READ_FAILED",
      context: { sourceFingerprint },
      cause: error,
      severity: "ephemeral",
    });
  }
}

async function readBoundedUtf8Body(
  response: Response,
  sourceFingerprint: string,
): Promise<{ body: string; byteLength: number }> {
  assertDeclaredLength(response, sourceFingerprint);
  if (!response.body) {
    return fetchError("ICS_FEED_BODY_MISSING", "Calendar feed response has no body.", {
      sourceFingerprint,
    });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await readChunk(reader, sourceFingerprint);
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_ICS_FEED_BYTES) {
        await reader.cancel("calendar feed exceeded size limit");
        return fetchError("ICS_FEED_TOO_LARGE", "Calendar feed exceeds the response-size limit.", {
          sourceFingerprint,
          limit: MAX_ICS_FEED_BYTES,
        });
      }
      body += decodeChunk(decoder, sourceFingerprint, chunk.value, true);
    }
    body += decodeChunk(decoder, sourceFingerprint);
  } finally {
    reader.releaseLock();
  }
  return { body, byteLength };
}

function conditionalHeaders(validators: IcsFetchValidators | undefined): {
  headers: Headers;
  etag: string | undefined;
  lastModified: string | undefined;
} {
  const headers = new Headers({
    accept: "text/calendar, text/plain;q=0.9, application/octet-stream;q=0.5",
  });
  const etag = safeValidator(validators?.etag);
  const lastModified = safeValidator(validators?.lastModified);
  if (etag) {
    headers.set("if-none-match", etag);
  }
  if (lastModified) {
    headers.set("if-modified-since", lastModified);
  }
  return { headers, etag, lastModified };
}

export async function fetchIcsFeed(args: {
  sourceUrl: string;
  validators?: IcsFetchValidators;
  transport?: IcsFetchTransport;
  signal?: AbortSignal;
}): Promise<IcsFetchResult> {
  const parsed = normalizeIcsSourceUrl(args.sourceUrl);
  const sourceFingerprint = fingerprintIcsSourceUrl(parsed);
  const { headers, etag, lastModified } = conditionalHeaders(args.validators);
  const guarded = await fetchWithSsrFGuard({
    url: parsed.href,
    init: { method: "GET", headers, redirect: "manual" },
    maxRedirects: MAX_ICS_REDIRECTS,
    timeoutMs: ICS_FETCH_TIMEOUT_MS,
    signal: args.signal,
    auditContext: "calendar-ics-feed",
    ...args.transport,
  });
  try {
    const { response } = guarded;
    const finalOrigin = new URL(guarded.finalUrl).origin;
    const responseEtag = response.headers.get("etag");
    const responseLastModified = response.headers.get("last-modified");
    if (response.status === 304) {
      return {
        state: "not_modified",
        finalOrigin,
        etag: responseEtag ?? etag ?? null,
        lastModified: responseLastModified ?? lastModified ?? null,
      };
    }
    if (!response.ok) {
      return fetchError(
        "ICS_FEED_HTTP_ERROR",
        `Calendar feed returned HTTP ${response.status}.`,
        { sourceFingerprint, finalOrigin, status: response.status },
        response.status >= 500 ? "ephemeral" : "fatal",
      );
    }
    const { body, byteLength } = await readBoundedUtf8Body(response, sourceFingerprint);
    return {
      state: "fetched",
      finalOrigin,
      etag: responseEtag,
      lastModified: responseLastModified,
      body,
      byteLength,
    };
  } finally {
    await guarded.release();
  }
}
