import { describe, expect, it } from "vitest";
import { extractBasicHtmlContent, htmlToMarkdown } from "./web-fetch-utils.js";

// Adapted from deer-flow test_web_fetch_relative_links.py (RESEARCH-0027).
const pageUrl = "https://example.com/docs/current";
describe("basic web fetch relative destinations", () => {
  it.each([
    ["../next", "https://example.com/next"],
    ["/reference", "https://example.com/reference"],
    ["?page=2", "https://example.com/docs/current?page=2"],
    ["#section", "https://example.com/docs/current#section"],
    ["//cdn.example.com/file", "https://cdn.example.com/file"],
    ["mailto:help@example.com", "mailto:help@example.com"],
  ])("resolves %s against the final page URL", async (href, expected) => {
    const result = await extractBasicHtmlContent({
      html: `<p><a href="${href}">Reference</a></p>`,
      extractMode: "markdown", url: pageUrl,
    });
    expect(result?.text).toBe(`[Reference](${expected})`);
  });

  it("uses the first base href while skipping target-only bases", () => {
    const html = `<base target="_blank"><base href="../assets/"><base href="/ignored/"><a href="next">Next</a>`;
    expect(htmlToMarkdown(html, pageUrl).text).toBe("[Next](https://example.com/assets/next)");
  });

  it("resolves a relative document base once through actual cleanup", async () => {
    const result = await extractBasicHtmlContent({
      html: `<base href="assets/"><a href="next">Next</a>`,
      extractMode: "markdown",
      url: pageUrl,
    });
    expect(result?.text).toBe("[Next](https://example.com/docs/assets/next)");
  });

  it.each(["http://[broken", "data:text/plain,invalid", "javascript:void(0)", "about:blank"])(
    "falls back to the page URL for invalid base %s", (base) => {
      expect(htmlToMarkdown(`<base href="${base}"><a href="../next">Next</a>`, pageUrl).text)
        .toBe("[Next](https://example.com/next)");
    },
  );

  it("keeps relative links for callers without a page URL", () => {
    expect(htmlToMarkdown(`<a href="../next">Next</a>`).text).toBe("[Next](../next)");
  });

  it("ignores document base examples inside comments and script text", () => {
    const html = `<!-- <base href="https://comment.example/"> -->
      <script>const example = '<base href="https://script.example/">';</script>
      <a href="../next?x=1&amp;y=2">Next</a>`;
    expect(htmlToMarkdown(html, pageUrl).text)
      .toBe("[Next](https://example.com/next?x=1&y=2)");
  });
});
