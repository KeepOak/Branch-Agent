// Adapted from danny-avila/LibreChat at f10b1d91f1eee3a2c82d5247bf620351486b7c1b,
// api/app/clients/tools/structured/GoogleSearch.js.

export type SearchRequest = <T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
) => Promise<T>;

export async function searchGoogle(
  options: { apiKey: string; searchEngineId: string; query: string; maxResults?: number },
  request: SearchRequest,
): Promise<Record<string, unknown>> {
  const { apiKey, searchEngineId, query, maxResults = 5 } = options;
  // Preserve upstream's five-result default and Google's ten-result per-request limit.
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) {
    throw new Error("count must be an integer from 1 to 10.");
  }
  return request(
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(searchEngineId)}&q=${encodeURIComponent(query)}&num=${maxResults}`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
    async (response) => {
      const json: unknown = await response.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new Error("Could not parse Google Search API results.");
      }
      const data = json as Record<string, unknown>;
      if (!response.ok) {
        const error = data.error as { message?: unknown } | undefined;
        const detail = typeof error?.message === "string" ? error.message : response.statusText;
        throw new Error(
          `Request failed with status ${response.status}: ${detail.replaceAll(apiKey, "***")}`,
        );
      }
      return data;
    },
  );
}
