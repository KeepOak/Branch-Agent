import {
  readConfiguredSecretString,
  readProviderEnvValue,
  readPositiveIntegerParam,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchTimeoutSeconds,
  throwWebSearchApiError,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  type SearchConfigRecord,
  type WebSearchProviderToolExecutionContext,
} from "branch/plugin-sdk/provider-web-search";
import { searchGoogle } from "./client.js";

export async function executeGoogleSearch(
  ctx: { config?: Record<string, unknown>; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
  context?: WebSearchProviderToolExecutionContext,
): Promise<Record<string, unknown>> {
  context?.signal?.throwIfAborted();
  const query = readStringParam(args, "query", { required: true });
  const config = resolveProviderWebSearchPluginConfig(ctx.config, "google-search");
  const apiKey =
    readConfiguredSecretString(
      config?.apiKey,
      "plugins.entries.google-search.config.webSearch.apiKey",
    ) ?? readProviderEnvValue(["GOOGLE_SEARCH_API_KEY"]);
  if (!apiKey) {
    return {
      error: "missing_google_search_api_key",
      message:
        "Set GOOGLE_SEARCH_API_KEY or plugins.entries.google-search.config.webSearch.apiKey.",
    };
  }
  const searchEngineId =
    typeof config?.searchEngineId === "string" && config.searchEngineId.trim()
      ? config.searchEngineId.trim()
      : readProviderEnvValue(["GOOGLE_CSE_ID"]);
  if (!searchEngineId) {
    return {
      error: "missing_google_search_engine_id",
      message:
        "Set GOOGLE_CSE_ID or plugins.entries.google-search.config.webSearch.searchEngineId.",
    };
  }
  const request = async <T>(
    url: string,
    init: RequestInit,
    read: (response: Response) => Promise<T>,
  ): Promise<T> => {
    context?.signal?.throwIfAborted();
    context?.assertCurrent?.();
    return withTrustedWebSearchEndpoint(
      {
        url,
        init,
        timeoutSeconds: resolveSearchTimeoutSeconds(ctx.searchConfig),
        signal: context?.signal,
      },
      async (response) => {
        if (!response.ok) {
          // Supply the configured key to the host error redactor without changing
          // the original HTTP request headers.
          const redactionHeaders = new Headers(init.headers);
          redactionHeaders.set("Authorization", `Bearer ${apiKey}`);
          return throwWebSearchApiError(response, "Google Search", {
            headers: redactionHeaders,
            signal: context?.signal,
          });
        }
        const result = await read(response);
        context?.signal?.throwIfAborted();
        return result;
      },
    );
  };
  const data = await searchGoogle(
    {
      apiKey,
      searchEngineId,
      query,
      maxResults: readPositiveIntegerParam(args, "count", {
        max: 10,
        message: "count must be an integer from 1 to 10.",
      }),
    },
    request,
  );
  const items = Array.isArray(data.items) ? data.items : [];
  const results = items.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.link !== "string") {
      return [];
    }
    return [
      {
        url: entry.link,
        title: wrapWebContent(typeof entry.title === "string" ? entry.title : "", "web_search"),
        description: wrapWebContent(
          typeof entry.snippet === "string" ? entry.snippet : "",
          "web_search",
        ),
      },
    ];
  });
  return {
    query,
    provider: "google-search",
    count: results.length,
    results,
    // The original tool returns all Google JSON, including pagination and engine metadata.
    raw: wrapWebContent(JSON.stringify(data), "web_search"),
  };
}
