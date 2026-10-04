// Protocol port of bytedance/deer-flow f840e843d3e2db1485cb65ceae73a5525aa80193,
// community/tencent_wsa/tools.py. SearchPro uses a Bearer API key, not TC3 signing.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  readProviderJsonObjectResponse,
  redactProviderResponseErrorText,
} from "branch/plugin-sdk/provider-http";
import { withStrictWebToolsEndpoint } from "branch/plugin-sdk/provider-web-fetch";
import {
  resolveProviderWebSearchPluginConfig,
  resolveWebSearchProviderCredential,
} from "branch/plugin-sdk/provider-web-search";
import {
  truncateSanitizedExternalContent,
  wrapWebContent,
} from "branch/plugin-sdk/security-runtime";

const ENDPOINT = "https://api.wsa.cloud.tencent.com/SearchPro";
const CREDENTIAL_PATH = "plugins.entries.tencent-wsa.config.webSearch.apiKey";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function coerceTencentWsaCount(value: unknown): number {
  const parsed =
    typeof value === "number" && Number.isInteger(value)
      ? value
      : typeof value === "string" && /^\d+$/u.test(value.trim())
        ? Number(value.trim())
        : undefined;
  return parsed !== undefined && parsed > 0 ? Math.min(parsed, 50) : 5;
}

export function buildTencentWsaRequest(
  query: string,
  count: number,
  mode: unknown,
): Record<string, unknown> {
  return {
    Query: query,
    ...(typeof mode === "number" && Number.isInteger(mode) && mode >= 0 && mode <= 2
      ? { Mode: mode }
      : {}),
    ...(count > 10 ? { Cnt: Math.ceil(count / 10) * 10 } : {}),
  };
}

export async function runTencentWsaSearch(params: {
  config?: BranchConfig;
  query: string;
  count?: unknown;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const query = params.query.trim();
  if (!query) {
    return { error: "Search query must not be empty", query };
  }
  const config = resolveProviderWebSearchPluginConfig(params.config, "tencent-wsa");
  const apiKey = resolveWebSearchProviderCredential({
    credentialValue: config?.apiKey,
    path: CREDENTIAL_PATH,
    envVars: ["TENCENTCLOUD_WSA_APIKEY"],
  });
  if (!apiKey) {
    return { error: "TENCENTCLOUD_WSA_APIKEY is not configured", query };
  }
  const count = coerceTencentWsaCount(
    config && Object.hasOwn(config, "maxResults") ? config.maxResults : params.count,
  );
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
  };
  // Redact exact active credentials, including escaped representations, before
  // sanitizing/truncating any server-originated field (including RequestId).
  const redact = (text: string) => redactProviderResponseErrorText(text, headers);
  const safeText = (text: string) => wrapWebContent(redact(text), "web_search");
  const safeErrorField = (text: string) =>
    wrapWebContent(truncateSanitizedExternalContent(redact(text), 1_000).text, "web_search");
  const error = (message: string, requestId?: string): Record<string, unknown> => ({
    error: message,
    query: redact(query),
    ...(requestId ? { request_id: requestId } : {}),
  });
  const startedAt = Date.now();
  let payload: Record<string, unknown>;
  try {
    payload = await withStrictWebToolsEndpoint(
      {
        url: ENDPOINT,
        timeoutSeconds: 30,
        signal: params.signal,
        beforeRequest: params.assertCurrent,
        // A SearchPro POST must not replay the query to another origin.
        rejectCrossOriginUnsafeRedirectReplay: true,
        init: {
          method: "POST",
          headers,
          body: JSON.stringify(buildTencentWsaRequest(query, count, config?.mode)),
        },
      },
      async ({ response }) => {
        if (!response.ok) {
          // The donor exposes only HTTP status. Do not echo statusText or body.
          throw new Error(`Tencent Cloud WSA API error: HTTP ${response.status}`);
        }
        return readProviderJsonObjectResponse(response, "Tencent Cloud WSA", {
          requestHeaders: headers,
          signal: params.signal,
        });
      },
    );
  } catch (cause) {
    params.signal?.throwIfAborted();
    params.assertCurrent?.();
    const status =
      cause instanceof Error && /^Tencent Cloud WSA API error: HTTP \d{3}$/u.test(cause.message)
        ? cause.message
        : "Tencent Cloud WSA request failed or returned an invalid response";
    return error(status);
  }
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const response = record(payload.Response);
  if (!response) {
    return error("Tencent Cloud WSA returned an unexpected response format");
  }
  const requestId =
    typeof response.RequestId === "string" && response.RequestId
      ? safeErrorField(response.RequestId)
      : undefined;
  const apiError = record(response.Error);
  if (apiError) {
    const code =
      typeof apiError.Code === "string" && apiError.Code ? apiError.Code : "UnknownError";
    return error(`Tencent Cloud WSA API error: ${safeErrorField(code)}`, requestId);
  }
  const pages = response.Pages;
  if (pages !== undefined && pages !== null && !Array.isArray(pages)) {
    return error("Tencent Cloud WSA returned an unexpected response format", requestId);
  }
  const results: Record<string, unknown>[] = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    let entry: Record<string, unknown> | undefined;
    if (typeof page === "string") {
      try {
        entry = record(JSON.parse(page));
      } catch {
        continue;
      }
    } else {
      entry = record(page);
    }
    if (!entry) {
      continue;
    }
    const content = entry.content || entry.passage || "";
    const rawUrl = typeof entry.url === "string" ? redact(entry.url) : "";
    let url = "";
    try {
      const parsed = new URL(rawUrl);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        !parsed.username &&
        !parsed.password
      ) {
        url = parsed.href === `${rawUrl}/` ? rawUrl : parsed.href;
      }
    } catch {
      // Keep the donor's result even without a usable citation URL.
    }
    const result: Record<string, unknown> = {
      title: typeof entry.title === "string" ? safeText(entry.title) : "",
      url,
      snippet: typeof content === "string" ? safeText(content) : "",
    };
    for (const field of ["date", "site", "score"] as const) {
      const value = entry[field];
      if (typeof value === "string" || typeof value === "number") {
        result[field] = typeof value === "string" ? safeText(value) : value;
      }
    }
    results.push(result);
    if (results.length >= count) {
      break;
    }
  }
  if (!results.length) {
    return error("No results found", requestId);
  }
  return {
    query: redact(query),
    provider: "tencent-wsa",
    count: results.length,
    total_results: results.length,
    tookMs: Date.now() - startedAt,
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "tencent-wsa",
      wrapped: true,
    },
    results,
    ...(requestId ? { request_id: requestId } : {}),
  };
}
