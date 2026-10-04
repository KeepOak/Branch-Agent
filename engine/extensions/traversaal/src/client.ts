// Adapted from danny-avila/LibreChat at f10b1d91f1eee3a2c82d5247bf620351486b7c1b,
// api/app/clients/tools/structured/TraversaalSearch.js.

export type SearchRequest = <T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
) => Promise<T>;

export async function searchTraversaal(
  options: { apiKey: string; query: string },
  request: SearchRequest,
): Promise<{ content: string; citations: string[] }> {
  return request(
    "https://api-ares.traversaal.ai/live/predict",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": options.apiKey },
      body: JSON.stringify({ query: [options.query] }),
    },
    async (response) => {
      const json: unknown = await response.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        throw new Error("Could not parse Traversaal API results. Please try again.");
      }
      const result = json as Record<string, unknown>;
      if (!response.ok) {
        const detail = String(result.error ?? result.message ?? response.statusText);
        throw new Error(
          `Request failed with status code ${response.status}: ${detail.replaceAll(options.apiKey, "***")}`,
        );
      }
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
        throw new Error("Could not parse Traversaal API results. Please try again.");
      }
      const data = result.data as Record<string, unknown>;
      const baseText = typeof data.response_text === "string" ? data.response_text : "";
      const sources = Array.isArray(data.web_url)
        ? data.web_url.filter((value): value is string => typeof value === "string")
        : [];
      const sourcesText = sources.length ? "\n\nSources:\n - " + sources.join("\n - ") : "";
      return {
        content: baseText + sourcesText || "No response found in Traversaal API results",
        citations: sources,
      };
    },
  );
}
