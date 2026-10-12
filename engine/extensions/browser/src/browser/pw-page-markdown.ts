import { avoidTrailingHighSurrogateBreak } from "@branch/normalization-core/utf16-slice";
import { truncateSanitizedExternalContent } from "branch/plugin-sdk/security-runtime";
/**
 * Adapted from bytedance/UI-TARS-desktop@2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a:
 * multimodal/agent-tars/core/src/environments/local/browser/content-extractor.ts.
 * Readability operates on a clone; Branch's existing converter renders markdown.
 */
import { htmlToMarkdown } from "branch/plugin-sdk/web-content-extractor";
import type { Page } from "playwright-core";
import { READABILITY_SCRIPT } from "./pw-readability-script.js";
import { neutralizeMediaDirectives } from "./vision.js";

export const DEFAULT_MARKDOWN_PAGE_SIZE = 100_000;

export type BrowserPageTextResult = {
  text: string;
  truncated: boolean;
  format?: "markdown";
  title?: string;
  totalPages?: number;
  currentPage?: number;
  hasMorePages?: boolean;
  pageSize?: number;
};

function validatePageNumber(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

/** Keep pagination metadata outside page text so continuation remains machine-readable. */
export function paginatePageMarkdown(
  html: string,
  title: string,
  pageSize: number,
  pageNumber: number,
): BrowserPageTextResult {
  validatePageNumber(pageSize, "maxChars");
  validatePageNumber(pageNumber, "pageNumber");
  const body = htmlToMarkdown(html).text;
  const markdown = truncateSanitizedExternalContent(
    neutralizeMediaDirectives(title ? `# ${title}\n\n${body}` : body),
    Number.MAX_SAFE_INTEGER,
  ).text;
  const { text, totalPages, currentPage } = sliceMarkdownPage(markdown, pageSize, pageNumber);
  const hasMorePages = currentPage < totalPages;
  return {
    text,
    truncated: hasMorePages,
    format: "markdown",
    title,
    totalPages,
    currentPage,
    hasMorePages,
    pageSize,
  };
}

function sliceMarkdownPage(markdown: string, pageSize: number, requestedPage: number) {
  let totalPages = 0;
  let text = "";
  for (let start = 0; start < markdown.length;) {
    const end = safeMarkdownPageEnd(markdown, start, pageSize);
    totalPages++;
    if (totalPages <= requestedPage) {
      text = markdown.slice(start, end);
    }
    start = end;
  }
  totalPages = Math.max(1, totalPages);
  return { text, totalPages, currentPage: Math.min(requestedPage, totalPages) };
}

/** Keep an inline MEDIA token attached to its prior character when a page would activate it. */
function safeMarkdownPageEnd(markdown: string, start: number, pageSize: number): number {
  let end = avoidTrailingHighSurrogateBreak(
    markdown,
    start,
    Math.min(start + pageSize, markdown.length),
  );
  if (/^[^\S\n]*MEDIA:/i.test(markdown.slice(end, end + pageSize))) {
    let previous = end;
    while (previous > start && /[^\S\n]/.test(markdown[previous - 1]!)) {
      previous--;
    }
    if (previous > start && markdown[previous - 1] !== "\n") {
      const boundary = previous - 1 > start ? previous - 1 : previous;
      end = avoidTrailingHighSurrogateBreak(markdown, start, boundary);
    }
  }
  return end;
}

/** Extract main content without mutating the page or fetching a second copy of it. */
export async function readPageMarkdown(
  page: Page,
  opts: { selector?: string; maxChars?: number; pageNumber?: number },
): Promise<BrowserPageTextResult> {
  const pageSize = opts.maxChars ?? DEFAULT_MARKDOWN_PAGE_SIZE;
  const pageNumber = opts.pageNumber ?? 1;
  validatePageNumber(pageSize, "maxChars");
  validatePageNumber(pageNumber, "pageNumber");
  const article = await page.evaluate(
    ({ script, selector }) => {
      type Article = { content?: string; title?: string };
      type Reader = new (document: Document) => { parse(): Article | null };
      const Reader = new Function("module", `${script}\nreturn module.exports`)({}) as Reader;
      const clone = document.cloneNode(true) as Document;
      clone
        .querySelectorAll("script,noscript,style,link,svg,img,video,iframe,canvas,.reflist")
        .forEach((element) => element.remove());
      if (selector) {
        const selected = clone.querySelector(selector);
        if (!selected) {
          throw new Error("Selector did not match an element");
        }
        clone.body.replaceChildren(selected.cloneNode(true));
      }
      const extracted = new Reader(clone).parse();
      return { html: extracted?.content ?? "", title: extracted?.title || document.title };
    },
    { script: READABILITY_SCRIPT, selector: opts.selector },
  );
  return paginatePageMarkdown(article.html, article.title, pageSize, pageNumber);
}
