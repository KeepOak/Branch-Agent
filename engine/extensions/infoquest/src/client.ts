// RESEARCH-0014: protocol port from bytedance/deer-flow
// f840e843d3e2db1485cb65ceae73a5525aa80193, community/infoquest.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  assertOkOrThrowHttpError,
  createProviderHttpError,
  ProviderHttpError,
  readProviderJsonObjectResponse,
  readProviderTextResponse,
  redactProviderResponseErrorText,
} from "branch/plugin-sdk/provider-http";
import { withStrictWebToolsEndpoint, wrapWebContent } from "branch/plugin-sdk/provider-web-fetch";
import { resolveWebSearchProviderCredential } from "branch/plugin-sdk/provider-web-search";
import { truncateSanitizedExternalContent } from "branch/plugin-sdk/security-runtime";
import { resolvePinnedHostnameWithPolicy, SsrFBlockedError } from "branch/plugin-sdk/ssrf-runtime";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { extractBasicHtmlContent } from "branch/plugin-sdk/web-content-extractor";
import { isTrustedToolExecutionPreflightError } from "../../../src/agents/tool-result-error.js";
import { extractReadableContent } from "../../../src/web-fetch/content-extractors.runtime.js";

const SEARCH_URL = "https://search.infoquest.bytepluses.com";
const READER_URL = "https://reader.infoquest.bytepluses.com";
export const INFOQUEST_HTTP_TIMEOUT_SECONDS = 30;
export type InfoQuestMode = "webSearch" | "webFetch" | "imageSearch";

export function infoQuestConfig(cfg: BranchConfig | undefined, mode: InfoQuestMode) {
  return asOptionalRecord(asOptionalRecord(cfg?.plugins?.entries?.infoquest?.config)?.[mode]) ?? {};
}

export function resolveInfoQuestCredential(cfg: BranchConfig | undefined, mode: InfoQuestMode) {
  return resolveWebSearchProviderCredential({
    credentialValue: infoQuestConfig(cfg, mode).apiKey,
    path: `plugins.entries.infoquest.config.${mode}.apiKey`,
    envVars: ["INFOQUEST_API_KEY"],
  });
}

// The donor rejects booleans, fractional numbers and non-integer strings. -1 is
// the documented default; zero and negative values also omit remote filters.
export function coerceInfoQuestSeconds(value: unknown): number {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : -1;
  }
  if (typeof value !== "string" || !/^[+-]?\d(?:_?\d)*$/u.test(value.trim())) {
    return -1;
  }
  const parsed = Number(value.trim().replaceAll("_", ""));
  return Number.isInteger(parsed) ? parsed : -1;
}

function headers(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function post<T extends string | Record<string, unknown>>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  readText: boolean,
  callerSignal?: AbortSignal,
  assertCurrent?: () => void,
): Promise<T> {
  callerSignal?.throwIfAborted();
  assertCurrent?.();
  const requestHeaders = headers(apiKey);
  // Branch bounds the complete local HTTP operation as well as the inherited
  // response-body inactivity wait. Neither is the upstream crawl timeout.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("InfoQuest HTTP request timed out after 30 seconds")),
    INFOQUEST_HTTP_TIMEOUT_SECONDS * 1000,
  );
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal;
  try {
    const result = await withStrictWebToolsEndpoint(
      {
        url,
        timeoutSeconds: INFOQUEST_HTTP_TIMEOUT_SECONDS,
        rejectCrossOriginUnsafeRedirectReplay: true,
        signal,
        beforeRequest: assertCurrent,
        init: { method: "POST", headers: requestHeaders, body: JSON.stringify(body) },
      },
      async ({ response }) => {
        await assertOkOrThrowHttpError(response, "InfoQuest API error", { requestHeaders, signal });
        const options = { requestHeaders, signal };
        if (readText && response.status !== 200) {
          throw await createProviderHttpError(response, "InfoQuest fetch API error", options);
        }
        return readText
          ? await readProviderTextResponse(response, "InfoQuest API error", options)
          : await readProviderJsonObjectResponse(response, "InfoQuest API error", options);
      },
    );
    signal.throwIfAborted();
    return result as T;
  } catch (error) {
    callerSignal?.throwIfAborted();
    signal.throwIfAborted();
    assertCurrent?.();
    if (isTrustedToolExecutionPreflightError(error)) {
      throw error;
    }
    if (error instanceof ProviderHttpError) {
      throw error;
    }
    const detail = redactProviderResponseErrorText(
      error instanceof Error ? error.message : String(error),
      requestHeaders,
    );
    // Never retain an unsanitized parser/transport cause.
    // oxlint-disable-next-line preserve-caught-error -- Transport/parser causes can quote active credentials.
    throw new Error(
      `InfoQuest request failed: ${wrapWebContent(truncateSanitizedExternalContent(detail, 500).text, "web_fetch")}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function publicResultUrl(value: unknown, apiKey: string): string | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    redactProviderResponseErrorText(value, headers(apiKey)) !== value
  ) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function external(value: unknown, apiKey: string, source: "web_search" | "web_fetch") {
  return wrapWebContent(redactProviderResponseErrorText(String(value), headers(apiKey)), source);
}

function cleanResults(payload: Record<string, unknown>, images: boolean, apiKey: string) {
  const search = asOptionalRecord(payload.search_result);
  if (!search) {
    if ("search_result" in payload) {
      throw new Error("InfoQuest returned malformed search_result");
    }
    if ("content" in payload) {
      throw new Error(`${images ? "image" : "web"} search API return wrong format`);
    }
    return undefined;
  }
  if (!Array.isArray(search.results)) {
    throw new Error("InfoQuest search_result.results must be an array");
  }
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const group of search.results) {
    const results = asOptionalRecord(asOptionalRecord(asOptionalRecord(group)?.content)?.results);
    if (!results) {
      throw new Error("InfoQuest search result has malformed content");
    }
    const append = (raw: unknown, type?: "page" | "news") => {
      const row = asOptionalRecord(raw);
      if (!row) {
        return;
      }
      const url = publicResultUrl(images ? row.original : row.url, apiKey);
      if (!url || seen.has(url) || (type === "news" && !row.title)) {
        return;
      }
      seen.add(url);
      const result: Record<string, unknown> = images ? { image_url: url } : { type, url };
      if ("title" in row) {
        result.title = external(row.title, apiKey, "web_search");
      }
      if (type === "page" && "desc" in row) {
        result.desc = external(row.desc, apiKey, "web_search");
        result.snippet = result.desc;
      }
      if (type === "news") {
        for (const field of ["time_frame", "source"]) {
          if (field in row) {
            result[field] = external(row[field], apiKey, "web_search");
          }
        }
      }
      rows.push(result);
    };
    if (images) {
      if (Array.isArray(results.images_results)) {
        results.images_results.forEach((row) => append(row));
      }
    } else {
      if (Array.isArray(results.organic)) {
        results.organic.forEach((row) => append(row, "page"));
      }
      const news = asOptionalRecord(results.top_stories);
      if (Array.isArray(news?.items)) {
        news.items.forEach((row) => append(row, "news"));
      }
    }
  }
  return rows;
}

export async function runInfoQuestSearch(params: {
  cfg?: BranchConfig;
  query: string;
  images?: boolean;
  site?: string;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const mode = params.images ? "imageSearch" : "webSearch";
  const config = infoQuestConfig(params.cfg, mode);
  const apiKey = resolveInfoQuestCredential(params.cfg, mode);
  if (!apiKey) {
    throw new Error(`INFOQUEST_API_KEY is not configured for ${mode}`);
  }
  const body: Record<string, unknown> = { format: "JSON", query: params.query };
  const range = coerceInfoQuestSeconds(
    params.images ? config.image_search_time_range : config.search_time_range,
  );
  if (params.images) {
    body.search_type = "Images";
    if (range >= 1 && range <= 365) {
      body.time_range = range;
    }
    const size = config.image_size === undefined ? "i" : config.image_size;
    if (size === "l" || size === "m" || size === "i") {
      body.image_size = size;
    }
  } else if (range > 0) {
    body.time_range = range;
  }
  if (params.site) {
    body.site = params.site;
  }
  const payload = await post<Record<string, unknown>>(
    SEARCH_URL,
    apiKey,
    body,
    false,
    params.signal,
    params.assertCurrent,
  );
  const results = cleanResults(payload, params.images === true, apiKey);
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  return {
    provider: "infoquest",
    query: params.query,
    ...(params.images ? { search_type: "Images" } : {}),
    ...(results
      ? { count: results.length, results }
      : { response: external(JSON.stringify(payload), apiKey, "web_search") }),
    externalContent: {
      untrusted: true,
      source: "web_search",
      provider: "infoquest",
      wrapped: true,
    },
  };
}

export async function runInfoQuestFetch(params: {
  cfg?: BranchConfig;
  url: string;
  maxChars?: number;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const config = infoQuestConfig(params.cfg, "webFetch");
  const apiKey = resolveInfoQuestCredential(params.cfg, "webFetch");
  if (!apiKey) {
    throw new Error("INFOQUEST_API_KEY is not configured for webFetch");
  }
  const url = new URL(params.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new SsrFBlockedError("InfoQuest fetch requires a public HTTP(S) URL without credentials");
  }
  await resolvePinnedHostnameWithPolicy(url.hostname, { signal: params.signal });
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const body: Record<string, unknown> = { url: params.url, format: "HTML" };
  for (const [setting, field] of [
    ["fetch_time", "fetch_time"],
    ["timeout", "timeout"],
    ["navigation_timeout", "navi_timeout"],
  ]) {
    const seconds = coerceInfoQuestSeconds(config[setting!]);
    if (seconds > 0) {
      body[field!] = seconds;
    }
  }
  const raw = await post<string>(
    READER_URL,
    apiKey,
    body,
    true,
    params.signal,
    params.assertCurrent,
  );
  if (!raw.trim()) {
    throw new Error("InfoQuest fetch: no result found");
  }
  let content = raw;
  try {
    const envelope = asOptionalRecord(JSON.parse(raw));
    const selected =
      envelope && ("reader_result" in envelope ? envelope.reader_result : envelope.content);
    if (selected !== undefined) {
      if (typeof selected !== "string") {
        throw new Error("InfoQuest reader content must be text");
      }
      content = selected;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    // The donor accepts raw HTML/plain text, and JSON without a recognized field.
  }
  if (!content.trim()) {
    throw new Error("InfoQuest fetch: no result found");
  }
  const safeContent = redactProviderResponseErrorText(content, headers(apiKey));
  const extracted =
    (await extractReadableContent({
      html: safeContent,
      url: params.url,
      extractMode: "markdown",
      config: params.cfg,
    })) ?? (await extractBasicHtmlContent({ html: safeContent, extractMode: "markdown" }));
  params.signal?.throwIfAborted();
  params.assertCurrent?.();
  const title = extracted?.title || "Untitled";
  const markdown = `# ${title}\n\n${extracted?.text ?? safeContent}`;
  // The pinned tool returns at most 4096 Unicode code points after extraction.
  const donorBounded = Array.from(markdown).slice(0, 4096).join("");
  const bounded = truncateSanitizedExternalContent(
    donorBounded,
    params.maxChars ?? donorBounded.length,
  );
  return {
    provider: "infoquest",
    url: params.url,
    finalUrl: params.url,
    extractMode: "markdown",
    title: external(title, apiKey, "web_fetch"),
    text: wrapWebContent(bounded.text, "web_fetch"),
    truncated: bounded.truncated || Array.from(markdown).length > 4096,
    externalContent: { untrusted: true, source: "web_fetch", provider: "infoquest", wrapped: true },
  };
}
