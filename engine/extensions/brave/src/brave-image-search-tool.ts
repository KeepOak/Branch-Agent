import { buildTimeoutAbortSignal } from "branch/plugin-sdk/extension-shared";
// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/community/brave/tools.py (atlas RESEARCH-0002). Converted image_search_tool to a native Branch tool; reuse shared endpoint, secret and HTTP contracts.
import type { BranchPluginToolContext } from "branch/plugin-sdk/plugin-entry";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-runtime";
import {
  assertOkOrThrowProviderError,
  readProviderJsonResponse,
} from "branch/plugin-sdk/provider-http";
import {
  jsonResult,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  withSelfHostedWebToolsEndpoint,
  withTrustedWebToolsEndpoint,
  wrapWebContent,
} from "branch/plugin-sdk/provider-web-search";
import { isBlockedHostnameOrIp } from "branch/plugin-sdk/ssrf-runtime";
import { asNonArrayRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { Type } from "typebox";
import {
  resolveBraveApiKey,
  resolveBraveBaseUrl,
  validateBraveBaseUrl,
} from "./brave-web-search-provider.runtime.js";

function imageCount(value: unknown): number {
  const numeric =
    typeof value === "number" || (typeof value === "string" && /^[+-]?\d+$/u.test(value.trim()))
      ? Number(value)
      : Number.NaN;
  return Math.max(1, Math.min(Number.isFinite(numeric) ? Math.trunc(numeric) : 5, 200));
}

function safePublicUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !isBlockedHostnameOrIp(url.hostname)
      ? value.trim()
      : "";
  } catch {
    return "";
  }
}

function normalizeImage(item: unknown) {
  const row = asNonArrayRecord(item);
  if (!row) return undefined;
  const properties = asNonArrayRecord(row.properties) ?? {};
  const thumbnail = asNonArrayRecord(row.thumbnail) ?? {};
  const safeImage = safePublicUrl(properties.url);
  const safeThumb = safePublicUrl(thumbnail.src);
  const present = (value: unknown) => typeof value === "string" && Boolean(value.trim());
  const imageUrl = safeImage || (!present(properties.url) ? safeThumb : "");
  const thumbnailUrl = safeThumb || (!present(thumbnail.src) ? safeImage : "");
  if (!imageUrl && !thumbnailUrl) return undefined;
  const dimensions = imageUrl
    ? safeImage
      ? properties
      : thumbnail
    : safeThumb
      ? thumbnail
      : properties;
  return {
    title: typeof row.title === "string" ? wrapWebContent(row.title, "web_search") : "",
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    source_url: safePublicUrl(row.url),
    source: typeof row.source === "string" ? wrapWebContent(row.source, "web_search") : "",
    width: dimensions.width,
    height: dimensions.height,
  };
}

async function imageRequest(
  url: URL,
  apiKey: string,
  signal: AbortSignal | undefined,
  selfHosted: boolean,
) {
  const withEndpoint = selfHosted ? withSelfHostedWebToolsEndpoint : withTrustedWebToolsEndpoint;
  return withEndpoint(
    {
      url: url.toString(),
      signal,
      init: {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      },
    },
    async ({ response }) => {
      await assertOkOrThrowProviderError(response, "Brave Image Search API error");
      return readProviderJsonResponse<Record<string, unknown>>(response, "Brave Image Search");
    },
  );
}

async function executeImageSearch(
  api: BranchPluginApi,
  ctx: BranchPluginToolContext | undefined,
  input: Record<string, unknown>,
  callerSignal?: AbortSignal,
) {
  callerSignal?.throwIfAborted();
  const cfg = ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
  const config = resolveProviderWebSearchPluginConfig(cfg, "brave");
  const query = readStringParam(input, "query", { required: true }).slice(0, 400);
  const apiKey = resolveBraveApiKey(config);
  if (!apiKey) return { error: "missing_brave_api_key", query };
  const { signal, cleanup } = buildTimeoutAbortSignal({ timeoutMs: 30_000, signal: callerSignal });
  try {
    const baseUrl = resolveBraveBaseUrl(config);
    const mode = await validateBraveBaseUrl(baseUrl, signal);
    const url = new URL(baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/res/v1/images/search`;
    url.search = "";
    const count = imageCount(input.max_results);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    for (const key of ["country", "search_lang", "safesearch", "spellcheck"]) {
      if (typeof input[key] === "string" || typeof input[key] === "boolean") {
        url.searchParams.set(key, String(input[key]));
      }
    }
    const data = await imageRequest(url, apiKey, signal, mode === "selfHosted");
    signal?.throwIfAborted();
    if (data.results !== undefined && !Array.isArray(data.results)) {
      throw new Error("Brave Image Search returned an unexpected response format");
    }
    const results = (Array.isArray(data.results) ? data.results : [])
      .map(normalizeImage)
      .filter((row) => row !== undefined)
      .slice(0, count);
    return results.length
      ? {
          query,
          total_results: results.length,
          results,
          usage_hint:
            "Use the 'image_url' values as reference images in image generation. Download them first if needed.",
        }
      : { error: "No safe image URLs found", query };
  } finally {
    cleanup();
  }
}

export function createBraveImageSearchTool(api: BranchPluginApi, ctx?: BranchPluginToolContext) {
  return {
    name: "brave_image_search",
    label: "Brave Image Search",
    resultContentSource: "network" as const,
    description:
      "Search for reference images using Brave Image Search. Returns image, thumbnail and source URLs with their dimensions.",
    parameters: Type.Object(
      {
        query: Type.String(),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        country: Type.Optional(Type.String()),
        search_lang: Type.Optional(Type.String()),
        safesearch: Type.Optional(Type.String()),
        spellcheck: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId: string, input: Record<string, unknown>, signal?: AbortSignal) =>
      jsonResult(await executeImageSearch(api, ctx, input, signal)),
  };
}
