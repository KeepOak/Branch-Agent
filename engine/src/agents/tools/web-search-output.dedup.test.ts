import { describe, expect, it } from "vitest";
import { normalizeWebSearchOutput } from "./web-search-output.js";

// First-occurrence link behavior adapted from khoj deduplicate_organic_results.
describe("web search source deduplication", () => {
  it("keeps the first occurrence of a link and reports the delivered count", () => {
    const result = normalizeWebSearchOutput({
      provider: "fixture",
      query: "sources",
      result: {
        count: 3,
        results: [
          { title: "First", url: "https://example.com/article", snippet: "Original" },
          { title: "Duplicate", url: "https://example.com/article", snippet: "Repeated" },
          { title: "Second", url: "https://example.com/other" },
        ],
      },
    });
    expect(result).toMatchObject({ kind: "results", count: 2 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.results.map((row) => row.url)).toEqual([
      "https://example.com/article",
      "https://example.com/other",
    ]);
    expect(result.results[0]?.title).toContain("First");
    expect(result.results[0]?.snippet).toContain("Original");
    expect(result).not.toHaveProperty("truncated");
  });

  it("does not spend the result limit on repeated sources", () => {
    const result = normalizeWebSearchOutput({
      provider: "fixture",
      query: "sources",
      result: {
        results: [
          ...Array.from({ length: 20 }, () => ({ title: "Same", url: "https://example.com" })),
          { title: "Unique", url: "https://example.com/unique" },
        ],
      },
    });
    expect(result).toMatchObject({ kind: "results", count: 2 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.results[1]?.url).toBe("https://example.com/unique");
    expect(result).not.toHaveProperty("truncated");
  });

  it("preserves distinct fragments and query destinations", () => {
    const urls = ["https://example.com/#first", "https://example.com/#second", "https://example.com/?p=2"];
    const result = normalizeWebSearchOutput({
      provider: "fixture", query: "sources",
      result: { results: urls.map((url) => ({ title: url, url })) },
    });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.results.map((row) => row.url)).toEqual(urls);
  });

  it("deduplicates canonical host case and default-port variants", () => {
    const result = normalizeWebSearchOutput({
      provider: "fixture",
      query: "sources",
      result: { results: [
        { title: "First", url: "https://EXAMPLE.com:443/article" },
        { title: "Second", url: "https://example.com/article" },
      ] },
    });
    expect(result).toMatchObject({ kind: "results", count: 1 });
    if (result.kind !== "results") throw new Error("expected results");
    expect(result.results[0]?.url).toBe("https://example.com/article");
    expect(result.results[0]?.title).toContain("First");
  });
});
