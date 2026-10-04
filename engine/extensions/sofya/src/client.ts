// Concrete HTTP port of bytedance/deer-flow f840e843d3e2db1485cb65ceae73a5525aa80193
// community/sofya/tools.py (sha256 6960535911b8ba6724d413e26f6263a27df8d6cd27cac52bfb26eeeb2ea7feaa).
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  assertOkOrThrowHttpError,
  ProviderHttpError,
  readProviderJsonObjectResponse,
  redactProviderResponseErrorText,
} from "branch/plugin-sdk/provider-http";
import { withStrictWebToolsEndpoint } from "branch/plugin-sdk/provider-web-fetch";
import { resolveWebSearchProviderCredential } from "branch/plugin-sdk/provider-web-search";
import {
  wrapWebContent,
  truncateSanitizedExternalContent,
} from "branch/plugin-sdk/security-runtime";
import { resolvePinnedHostnameWithPolicy, SsrFBlockedError } from "branch/plugin-sdk/ssrf-runtime";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { SearchTimeRange } from "./search-time-range.js";

const BASE_URL = "https://sofya.co/v1";
const TIMEOUT_SECONDS = 60;
const FETCH_MAX_CHARS = 4096;

export function sofyaConfig(cfg: BranchConfig | undefined, mode: "webSearch" | "webFetch") {
  return asOptionalRecord(asOptionalRecord(cfg?.plugins?.entries?.sofya?.config)?.[mode]) ?? {};
}

export function resolveSofyaCredential(
  cfg: BranchConfig | undefined,
  mode: "webSearch" | "webFetch",
) {
  return resolveWebSearchProviderCredential({
    credentialValue: sofyaConfig(cfg, mode).apiKey,
    path: `plugins.entries.sofya.config.${mode}.apiKey`,
    envVars: ["SOFYA_API_KEY"],
  });
}

// Python int accepts integral strings and truncates numeric values, but rejects null,
// infinity, decimal strings and empty strings. Preserve that coercion contract.
function pythonInteger(value: unknown): number | undefined {
  if (typeof value === "boolean") {
    return Number(value);
  }
  if (typeof value === "string" && !/^[+-]?\d+$/u.test(value.trim())) {
    return undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

export function coerceMaxResults(value: unknown): number {
  const number = pythonInteger(value);
  return number !== undefined && number > 0 ? Math.min(number, 20) : 5;
}

export function coerceContentLimit(value: unknown): number {
  const number = pythonInteger(value);
  return number !== undefined && number >= 0 ? number : 2000;
}

export function resolveSearchDepth(value: unknown): "basic" | "snippets" {
  return typeof value === "string" && value.trim().toLowerCase() === "snippets"
    ? "snippets"
    : "basic";
}

function clip(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : String(value);
  // Python slices Unicode code points, preserving astral characters.
  return limit > 0 ? Array.from(text).slice(0, limit).join("") : text;
}

function responseResults(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (payload.results === undefined || payload.results === null) {
    return [];
  }
  if (!Array.isArray(payload.results)) {
    throw new Error("Sofya returned an unexpected response format");
  }
  return payload.results.flatMap((value) => {
    const record = asOptionalRecord(value);
    return record ? [record] : [];
  });
}

function requestHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function post(
  path: "/search" | "/fetch",
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const headers = requestHeaders(apiKey);
  let result: Record<string, unknown>;
  try {
    result = await withStrictWebToolsEndpoint(
      {
        url: `${BASE_URL}${path}`,
        timeoutSeconds: TIMEOUT_SECONDS,
        signal,
        init: { method: "POST", headers, body: JSON.stringify(body) },
      },
      async ({ response }) => {
        // Both host helpers receive the active request credential context before any
        // diagnostic parsing/truncation. Never retain parser causes quoting the key.
        await assertOkOrThrowHttpError(response, "Sofya API error", {
          requestHeaders: headers,
          signal,
        });
        return await readProviderJsonObjectResponse(response, "Sofya API error", {
          requestHeaders: headers,
          signal,
        });
      },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ProviderHttpError) {
      throw error;
    }
    const detail = redactProviderResponseErrorText(
      error instanceof Error ? error.message : String(error),
      headers,
    );
    const safe = new Error(
      `Sofya request failed: ${wrapWebContent(truncateSanitizedExternalContent(detail, 500).text, "web_fetch")}`,
    );
    safe.name = error instanceof Error ? error.name : "Error";
    throw safe;
  }
  signal?.throwIfAborted();
  return result;
}

function external(value: unknown): string {
  const text = typeof value === "string" ? value : String(value);
  return text ? wrapWebContent(text, "web_search") : "";
}

function safeResultUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export async function runSofyaSearch(params: {
  cfg?: BranchConfig;
  query: string;
  count?: unknown;
  timeRange?: SearchTimeRange;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  const config = sofyaConfig(params.cfg, "webSearch");
  const count = coerceMaxResults(params.count ?? config.maxResults);
  const apiKey = resolveSofyaCredential(params.cfg, "webSearch");
  if (!apiKey) {
    throw new Error("SOFYA_API_KEY is not configured");
  }
  const payload = await post(
    "/search",
    apiKey,
    {
      query: params.query,
      max_results: count,
      search_depth: resolveSearchDepth(config.searchDepth),
      ...(params.timeRange ? { freshness: params.timeRange } : {}),
    },
    params.signal,
  );
  const rows = responseResults(payload).slice(0, count);
  if (!rows.length) {
    return {
      provider: "sofya",
      query: params.query,
      error: "No results found",
      count: 0,
      results: [],
    };
  }
  const limit = coerceContentLimit(config.contentsMaxCharacters);
  return {
    provider: "sofya",
    query: params.query,
    count: rows.length,
    total_results: rows.length,
    externalContent: { untrusted: true, source: "web_search", provider: "sofya", wrapped: true },
    results: rows.map((row) => ({
      title: external(row.title ?? ""),
      url: safeResultUrl(row.url),
      content: external(clip(row.content || row.description || "", limit)),
    })),
  };
}

export async function runSofyaFetch(params: {
  cfg?: BranchConfig;
  url: string;
  maxChars?: number;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  const apiKey = resolveSofyaCredential(params.cfg, "webFetch");
  if (!apiKey) {
    throw new Error("SOFYA_API_KEY is not configured");
  }
  const url = new URL(params.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new SsrFBlockedError("Sofya fetch requires a public HTTP(S) URL without credentials");
  }
  // Hosted fetch is a second network boundary. Check DNS before handing the URL
  // to the upstream service, using the same host policy as Branch web fetch.
  await resolvePinnedHostnameWithPolicy(url.hostname, { signal: params.signal });
  params.signal?.throwIfAborted();
  const rows = responseResults(await post("/fetch", apiKey, { urls: [params.url] }, params.signal));
  const row = rows[0];
  if (!row) {
    throw new Error("No results found");
  }
  if (row.success === false) {
    const detail = redactProviderResponseErrorText(
      String(row.error || "Failed to fetch the URL"),
      requestHeaders(apiKey),
    );
    throw new Error(
      `Sofya fetch failed: ${wrapWebContent(truncateSanitizedExternalContent(detail, 500).text, "web_fetch")}`,
    );
  }
  const content = clip(row.content || "", FETCH_MAX_CHARS);
  if (!content) {
    throw new Error("No content found");
  }
  const markdown = `# ${String(row.title || "Untitled")}\n\n${content}`;
  const bounded = truncateSanitizedExternalContent(markdown, params.maxChars ?? markdown.length);
  return {
    url: params.url,
    finalUrl: params.url,
    provider: "sofya",
    extractMode: "markdown",
    title: wrapWebContent(String(row.title || "Untitled"), "web_fetch"),
    text: wrapWebContent(bounded.text, "web_fetch"),
    truncated: bounded.truncated || Array.from(String(row.content || "")).length > FETCH_MAX_CHARS,
    externalContent: { untrusted: true, source: "web_fetch", provider: "sofya", wrapped: true },
  };
}
