import { renderMarkdownFence, renderWikiMarkdown } from "./markdown.js";

export function buildSourcePage(raw: string, updatedAt: string): string {
  return renderWikiMarkdown({
    frontmatter: {
      pageType: "source",
      id: "source.imported",
      title: "imported",
      sourceType: "memory-unsafe-local",
      status: "active",
      updatedAt,
    },
    body: [
      "# imported",
      "",
      "## Content",
      renderMarkdownFence(raw, "text"),
      "",
      "## Notes",
      "<!-- branch:human:start -->",
      "<!-- branch:human:end -->",
      "",
    ].join("\n"),
  });
}
