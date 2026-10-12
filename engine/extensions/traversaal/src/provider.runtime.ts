import {
  readConfiguredSecretString,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchTimeoutSeconds,
  throwWebSearchApiError,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  type SearchConfigRecord,
  type WebSearchProviderToolExecutionContext,
} from "branch/plugin-sdk/provider-web-search";
import { searchTraversaal } from "./client.js";

export async function executeTraversaalSearch(
  ctx: { config?: Record<string, unknown>; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
  context?: WebSearchProviderToolExecutionContext,
): Promise<Record<string, unknown>> {
  context?.signal?.throwIfAborted();
  const query = readStringParam(args, "query", { required: true });
  const config = resolveProviderWebSearchPluginConfig(ctx.config, "traversaal");
  const apiKey =
    readConfiguredSecretString(
      config?.apiKey,
      "plugins.entries.traversaal.config.webSearch.apiKey",
    ) ?? readProviderEnvValue(["TRAVERSAAL_API_KEY"]);
  if (!apiKey) {
    return {
      error: "missing_traversaal_api_key",
      message: "Set TRAVERSAAL_API_KEY or plugins.entries.traversaal.config.webSearch.apiKey.",
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
          return throwWebSearchApiError(response, "Traversaal", {
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
  const result = await searchTraversaal({ apiKey, query }, request);
  return {
    query,
    provider: "traversaal",
    content: wrapWebContent(result.content, "web_search"),
    citations: result.citations,
  };
}
