// Protocol port of deer-flow f840e843d3e2db1485cb65ceae73a5525aa80193,
// community/groundroute/tools.py (RESEARCH-0013). Host owns credentials and transport.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  assertOkOrThrowProviderError,
  ProviderHttpError,
  readProviderJsonObjectResponse,
  redactProviderResponseErrorText,
} from "branch/plugin-sdk/provider-http";
import { markdownToText, withStrictWebToolsEndpoint } from "branch/plugin-sdk/provider-web-fetch";
import { normalizeSecretInput } from "branch/plugin-sdk/secret-input";
import { resolveReadOnlyEnvSecretRef } from "branch/plugin-sdk/secret-ref-readonly";
import { wrapWebContent } from "branch/plugin-sdk/security-runtime";
import { resolvePinnedHostnameWithPolicy, SsrFBlockedError } from "branch/plugin-sdk/ssrf-runtime";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";

export type GroundRouteScope = "webSearch" | "webFetch";
export const GROUNDROUTE_ENDPOINT = "https://api.groundroute.ai/v1/search";
const ENV_KEY = "GROUNDROUTE_API_KEY";
const RESPONSE_MAX_BYTES = 16 * 1024 * 1024;

export function getGroundRouteConfig(cfg: BranchConfig | undefined, scope: GroundRouteScope) {
  return asOptionalRecord(asOptionalRecord(cfg?.plugins?.entries?.groundroute?.config)?.[scope]);
}

export function resolveGroundRouteApiKey(cfg: BranchConfig | undefined, scope: GroundRouteScope) {
  const resolved = resolveReadOnlyEnvSecretRef({
    cfg,
    path: `plugins.entries.groundroute.config.${scope}.apiKey`,
    value: getGroundRouteConfig(cfg, scope)?.apiKey,
    expectedEnvId: ENV_KEY,
    normalizeValue: normalizeSecretInput,
  });
  return resolved.status === "available"
    ? resolved.value
    : resolved.status === "blocked"
      ? undefined
      : normalizeSecretInput(process.env[ENV_KEY]) || undefined;
}

// Python int(): finite numeric values truncate; decimal strings must be integers.
export function coerceGroundRouteCount(value: unknown): number {
  let number = 5;
  if (typeof value === "number" && Number.isFinite(value)) {
    number = Math.trunc(value);
  } else if (typeof value === "boolean") {
    number = Number(value);
  } else if (typeof value === "string" && /^[+-]?\d(?:_?\d)*$/u.test(value.trim())) {
    // Python integers do not overflow on long configured integer strings.
    const parsed = BigInt(value.trim().replaceAll("_", ""));
    number = parsed > 50n ? 50 : parsed < 1n ? 1 : Number(parsed);
  }
  return Math.max(1, Math.min(number, 50));
}

export async function assertGroundRouteUrlAllowed(
  value: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SsrFBlockedError("GroundRoute requires a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new SsrFBlockedError("GroundRoute requires an HTTP(S) URL without embedded credentials.");
  }
  await resolvePinnedHostnameWithPolicy(url.hostname, { signal });
  signal.throwIfAborted();
}

function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key] : "";
}

function externalField(value: string, source: "web_search" | "web_fetch"): string {
  return value ? wrapWebContent(value, source) : "";
}

async function safeResultUrl(value: string, signal: AbortSignal): Promise<string> {
  if (!value) {
    return "";
  }
  try {
    await assertGroundRouteUrlAllowed(value, signal);
    const url = new URL(value);
    return url.href === `${value}/` ? value : url.href;
  } catch {
    signal.throwIfAborted();
    return "";
  }
}

type RequestParams = {
  cfg?: BranchConfig;
  signal?: AbortSignal;
  assertCurrent?: () => void;
};

async function postGroundRoute(
  params: RequestParams,
  scope: GroundRouteScope,
  body: Record<string, unknown>,
  parse: (
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const key = resolveGroundRouteApiKey(params.cfg, scope);
  if (!key) {
    return {
      error: "missing_groundroute_api_key",
      message: "GROUNDROUTE_API_KEY is not configured",
    };
  }
  // Donor transport deadline is 30 seconds, including body reads and URL checks.
  const deadline = AbortSignal.timeout(30_000);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  let result: Record<string, unknown>;
  try {
    result = await withStrictWebToolsEndpoint(
      {
        url: GROUNDROUTE_ENDPOINT,
        timeoutSeconds: 30,
        signal,
        beforeRequest: () => {
          signal.throwIfAborted();
          params.assertCurrent?.();
        },
        init: { method: "POST", headers, body: JSON.stringify(body) },
      },
      async ({ response }) => {
        await assertOkOrThrowProviderError(response, "GroundRoute API error", {
          requestHeaders: headers,
          signal,
        });
        const payload = await readProviderJsonObjectResponse(response, "GroundRoute API error", {
          maxBytes: RESPONSE_MAX_BYTES,
          requestHeaders: headers,
          signal,
        });
        signal.throwIfAborted();
        params.assertCurrent?.();
        return await parse(payload, signal);
      },
    );
  } catch (error) {
    signal.throwIfAborted();
    params.assertCurrent?.();
    if (error instanceof ProviderHttpError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "request failed";
    // oxlint-disable-next-line preserve-caught-error -- Transport causes may retain active credentials; only keep the header-redacted diagnostic.
    throw new Error(
      `GroundRoute request failed: ${redactProviderResponseErrorText(detail, headers)}`,
    );
  }
  signal.throwIfAborted();
  params.assertCurrent?.();
  return result;
}

export async function runGroundRouteSearch(
  params: RequestParams & { query: string; count?: unknown },
): Promise<Record<string, unknown>> {
  const count = coerceGroundRouteCount(
    params.count ?? getGroundRouteConfig(params.cfg, "webSearch")?.maxResults,
  );
  return postGroundRoute(
    params,
    "webSearch",
    { query: params.query, max_results: count },
    async (data, signal) => {
      const rows = Array.isArray(data.results) ? data.results : [];
      if (!rows.length) {
        return { provider: "groundroute", query: params.query, error: "No results found" };
      }
      const results: Record<string, unknown>[] = [];
      // The donor maps all returned rows. Its 50 cap applies to requests, not responses.
      for (const raw of rows) {
        signal.throwIfAborted();
        const row = asOptionalRecord(raw);
        if (!row) {
          continue;
        }
        const snippet = stringField(row, "snippet");
        results.push({
          title: externalField(stringField(row, "title"), "web_search"),
          url: await safeResultUrl(stringField(row, "url"), signal),
          snippet: externalField(snippet, "web_search"),
          description: externalField(snippet, "web_search"),
          source_engine: externalField(stringField(row, "source_engine"), "web_search"),
        });
      }
      return {
        provider: "groundroute",
        query: params.query,
        count: results.length,
        externalContent: {
          untrusted: true,
          source: "web_search",
          provider: "groundroute",
          wrapped: true,
        },
        results,
      };
    },
  );
}

export async function runGroundRouteFetch(
  params: RequestParams & { url: string; extractMode?: "markdown" | "text"; maxChars?: number },
): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  const targetDeadline = AbortSignal.timeout(30_000);
  const signal = params.signal ? AbortSignal.any([params.signal, targetDeadline]) : targetDeadline;
  await assertGroundRouteUrlAllowed(params.url, signal);
  return postGroundRoute(
    { ...params, signal },
    "webFetch",
    { query: params.url, mode: "page", max_results: 1 },
    async (data, requestSignal) => {
      const first = Array.isArray(data.results) ? asOptionalRecord(data.results[0]) : undefined;
      if (!first) {
        return { provider: "groundroute", url: params.url, error: "No results found" };
      }
      const content = stringField(first, "content") || stringField(first, "snippet");
      const limit = Math.min(params.maxChars ?? 4096, 4096);
      // Python slice counts code points, preserving supplementary characters at the boundary.
      const bounded = Array.from(content).slice(0, limit).join("");
      const markdown = `# ${stringField(first, "title")}\n\n${bounded}`;
      const extractMode = params.extractMode ?? "markdown";
      const text = extractMode === "text" ? markdownToText(markdown) : markdown;
      return {
        url: params.url,
        finalUrl: (await safeResultUrl(stringField(first, "url"), requestSignal)) || params.url,
        title: externalField(stringField(first, "title"), "web_fetch"),
        extractor: "groundroute",
        extractMode,
        externalContent: { untrusted: true, source: "web_fetch", wrapped: true },
        truncated: bounded.length < content.length,
        rawLength: content.length,
        length: text.length,
        text: wrapWebContent(text, "web_fetch"),
      };
    },
  );
}
