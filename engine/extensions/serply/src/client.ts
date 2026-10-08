import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  assertOkOrThrowProviderError,
  readProviderJsonObjectResponse,
  redactProviderResponseErrorText,
} from "branch/plugin-sdk/provider-http";
import { withStrictWebToolsEndpoint } from "branch/plugin-sdk/provider-web-fetch";
import { resolveProviderWebSearchPluginConfig } from "branch/plugin-sdk/provider-web-search-contract";
import { normalizeSecretInput } from "branch/plugin-sdk/secret-input";
import { resolveReadOnlyEnvSecretRef } from "branch/plugin-sdk/secret-ref-readonly";
import { wrapWebContent } from "branch/plugin-sdk/security-runtime";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { decodeHTML } from "entities";

// Protocol port: bytedance/deer-flow f840e843d3e2db1485cb65ceae73a5525aa80193,
// community/serply/tools.py (SHA256 388d1ae1fd139f95f3ac860d29cf27088db887bfe8369db84de101662856b1e5).
// The host supplies credentials, guarded transport, bounded readers and content trust boundaries.
const ENDPOINT = "https://api.serply.io/v1";
const VERTICALS = { search: "results", news: "entries", scholar: "articles" } as const;
type Vertical = keyof typeof VERTICALS;
export const SERPLY_CREDENTIAL_PATH = "plugins.entries.serply.config.webSearch.apiKey";

export function coerceSerplyCount(value: unknown): number {
  let count = 5;
  if (typeof value === "number" && Number.isFinite(value)) {
    count = Math.trunc(value);
  } else if (typeof value === "boolean") {
    count = Number(value);
  } else if (typeof value === "string" && /^[+-]?\d+$/u.test(value.trim())) {
    const parsed = Number(value);
    count = Number.isFinite(parsed) ? parsed : value.trim().startsWith("-") ? 5 : 100;
  }
  return count < 1 ? 5 : Math.min(count, 100);
}

export function coerceSerplyVertical(value: unknown): Vertical {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "news" || normalized === "scholar" ? normalized : "search";
}

export function cleanSerplyQuery(query: string): string {
  // Python's slicing counts Unicode code points, not UTF-16 code units.
  return [...query.trim()].slice(0, 500).join("");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function citationUrl(value: unknown): string {
  if (typeof value !== "string" || !value) {
    return "";
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href === `${value}/`
        ? value
        : url.href
      : "";
  } catch {
    return "";
  }
}
function wrap(value: unknown): string {
  const valueText = text(value);
  return valueText ? wrapWebContent(valueText, "web_search") : "";
}

export function normalizeSerplyRows(
  payload: Record<string, unknown>,
  vertical: Vertical,
  count: number,
) {
  const candidates = payload[VERTICALS[vertical]] ?? [];
  if (!Array.isArray(candidates)) {
    throw new Error("Serply returned an unexpected response format");
  }
  // Filter before applying the donor cap, including News which ignores num server-side.
  return candidates
    .flatMap((candidate) => {
      const row = asOptionalRecord(candidate);
      return row ? [row] : [];
    })
    .slice(0, count)
    .map((row) => {
      const base = { title: wrap(row.title), url: citationUrl(row.link) };
      if (vertical === "news") {
        return Object.assign(base, {
          content: wrap(decodeHTML(text(row.summary).replace(/<[^>]+>/gu, "")).trim()),
          published: wrap(row.published),
          source: wrap(asOptionalRecord(row.source)?.title),
        });
      }
      if (vertical === "scholar") {
        const author = asOptionalRecord(row.author);
        const authors = Array.isArray(author?.authors) ? author.authors : [];
        const citations = asOptionalRecord(asOptionalRecord(row.extras)?.citations);
        return Object.assign(base, {
          content: wrap(row.description),
          authors: authors.flatMap((entry) => {
            const record = asOptionalRecord(entry);
            return record ? [wrap(record.name)] : [];
          }),
          cited_by:
            typeof citations?.count === "number" && Number.isFinite(citations.count)
              ? citations.count
              : 0,
          pdf_url: citationUrl(asOptionalRecord(row.doc)?.link),
        });
      }
      return Object.assign(base, { content: wrap(row.description) });
    });
}

export function resolveSerplyApiKey(
  cfg?: BranchConfig,
  searchConfig?: Record<string, unknown>,
): string | undefined {
  const plugin = resolveProviderWebSearchPluginConfig(cfg, "serply");
  const scoped = asOptionalRecord(searchConfig?.serply);
  const configured = plugin?.apiKey === undefined ? scoped?.apiKey : plugin.apiKey;
  const resolution = resolveReadOnlyEnvSecretRef({
    value: configured,
    path: SERPLY_CREDENTIAL_PATH,
    cfg,
    expectedEnvId: "SERPLY_API_KEY",
    normalizeValue: normalizeSecretInput,
  });
  if (resolution.status === "blocked") {
    return undefined;
  }
  return resolution.status === "available"
    ? resolution.value
    : normalizeSecretInput(process.env.SERPLY_API_KEY);
}

export async function runSerplySearch(params: {
  cfg?: BranchConfig;
  searchConfig?: Record<string, unknown>;
  query: string;
  count?: unknown;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  const config =
    resolveProviderWebSearchPluginConfig(params.cfg, "serply") ??
    asOptionalRecord(params.searchConfig?.serply) ??
    {};
  const count = coerceSerplyCount(
    config.maxResults === undefined ? params.count : config.maxResults,
  );
  const vertical = coerceSerplyVertical(config.vertical);
  const query = cleanSerplyQuery(params.query);
  const apiKey = resolveSerplyApiKey(params.cfg, params.searchConfig);
  if (!apiKey) {
    return { error: "missing_serply_api_key", message: "SERPLY_API_KEY is not configured", query };
  }
  const url = new URL(`${ENDPOINT}/${vertical}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(count));
  for (const field of ["gl", "hl"] as const) {
    if (config[field] !== undefined) {
      url.searchParams.set(field, String(config[field]));
    }
  }
  const headers = { "X-Api-Key": apiKey, Accept: "application/json", "User-Agent": "Branch" };
  const started = Date.now();
  let status: number | undefined;
  try {
    const results = await withStrictWebToolsEndpoint(
      {
        url: url.href,
        timeoutSeconds: 30,
        signal: params.signal,
        requireHttps: true,
        init: { method: "GET", headers },
      },
      async ({ response }) => {
        status = response.status;
        // Both diagnostics and malformed JSON get the actual outgoing header context.
        // The guard's timeout also remains active while the response body is consumed.
        await assertOkOrThrowProviderError(response, "Serply API error", {
          requestHeaders: headers,
          signal: params.signal,
        });
        const payload = await readProviderJsonObjectResponse(response, "Serply API error", {
          requestHeaders: headers,
          signal: params.signal,
        });
        return normalizeSerplyRows(payload, vertical, count);
      },
    );
    params.signal?.throwIfAborted();
    if (!results.length) {
      return { error: "No results found", query };
    }
    return {
      query,
      provider: "serply",
      vertical,
      total_results: results.length,
      count: results.length,
      tookMs: Date.now() - started,
      externalContent: { untrusted: true, source: "web_search", provider: "serply", wrapped: true },
      results,
    };
  } catch (error) {
    params.signal?.throwIfAborted();
    // Never retain raw provider causes or response bodies. Redact active credentials before
    // applying the donor's 500-character diagnostic cap, regardless of logging settings.
    const detail =
      status !== undefined && (status < 200 || status >= 300)
        ? `Serply API error: HTTP ${status}`
        : [
            ...redactProviderResponseErrorText(
              error instanceof Error ? error.message : "Serply request failed",
              headers,
            ),
          ]
            .slice(0, 500)
            .join("");
    return {
      error: wrapWebContent(detail, "web_search"),
      query: redactProviderResponseErrorText(query, headers),
    };
  }
}
