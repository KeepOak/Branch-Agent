/** Source-faithful search/find formatting and lossless browser tool continuations. */
import type { AgentToolResult } from "branch/plugin-sdk/agent-core";
import { readPositiveIntegerParam } from "branch/plugin-sdk/param-readers";
import { DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS } from "branch/plugin-sdk/text-utility-runtime";
import { textResult } from "branch/plugin-sdk/tool-results";
import type { executeConsoleAction } from "./browser-tool.actions.js";
import {
  browserSearchPage,
  browserFindElements,
  normalizeOptionalString,
} from "./browser-tool.runtime.js";
import { wrapBrowserExternalText } from "./browser-tool.snapshot.js";
import { paginateBrowserText } from "./browser/pw-page-markdown.js";
import {
  readSearchPageOptions,
  readFindElementsOptions,
  type PageSearchResult,
  type PageFindResult,
} from "./browser/pw-page-search.js";

export function formatPageSearch(result: PageSearchResult, pattern: string): string {
  if (!result.total) {
    return `No matches found for "${pattern}" on page.`;
  }
  const lines = [
    `Found ${result.total} match${result.total === 1 ? "" : "es"} for "${pattern}" on page:`,
    "",
  ];
  result.matches.forEach((match, index) => {
    const location = match.elementPath ? ` (in ${match.elementPath})` : "";
    lines.push(`[${index + 1}] ${match.context}${location}`);
  });
  if (result.hasMore) {
    lines.push(
      `\n... showing ${result.matches.length} of ${result.total} total matches. Increase maxResults to see more.`,
    );
  }
  return lines.join("\n");
}

export function formatPageFind(result: PageFindResult, selector: string): string {
  if (!result.total) {
    return `No elements found matching "${selector}".`;
  }
  const lines = [
    `Found ${result.total} element${result.total === 1 ? "" : "s"} matching "${selector}":`,
    "",
  ];
  for (const element of result.elements) {
    const parts = [`[${element.index}] <${element.tag}>`];
    if (element.text) {
      const text = element.text.trim().replace(/\s+/g, " ");
      parts.push(`"${text.length > 120 ? `${text.slice(0, 120)}...` : text}"`);
    }
    if (element.attrs && Object.keys(element.attrs).length) {
      parts.push(
        `{${Object.entries(element.attrs)
          .map(([key, value]) => `${key}="${value}"`)
          .join(", ")}}`,
      );
    }
    parts.push(`(${element.childrenCount} children)`);
    lines.push(parts.join(" "));
  }
  if (result.showing < result.total) {
    lines.push(
      `\nShowing ${result.showing} of ${result.total} total elements. Increase maxResults to see more.`,
    );
  }
  return lines.join("\n");
}

function inspectionPrefix(page: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  hasMorePages: boolean;
}): string {
  const continuation = page.hasMorePages
    ? ` Continue with pageNumber=${page.currentPage + 1}, maxChars=${page.pageSize}, and unchanged search/find arguments.`
    : "";
  return `Output page ${page.currentPage}/${page.totalPages}.${continuation}`;
}

function inspectionPageSize(input: Record<string, unknown>): number {
  const largest = Number.MAX_SAFE_INTEGER;
  const prefix = inspectionPrefix({
    currentPage: largest,
    totalPages: largest,
    pageSize: largest,
    hasMorePages: true,
  });
  const empty = wrapBrowserExternalText({ value: "", marker: "", includeWarning: true, prefix });
  const capacity = DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS - empty.text.length;
  return Math.min(readPositiveIntegerParam(input, "maxChars") ?? capacity, capacity);
}

async function collectInspection(
  kind: "search" | "find",
  params: Parameters<typeof executeConsoleAction>[0],
) {
  const { input, baseUrl, proxyRequest, profile, signal } = params;
  const options = { targetId: normalizeOptionalString(input.targetId), profile, signal };
  if (kind === "search") {
    const search = readSearchPageOptions(input);
    const result = await browserSearchPage(proxyRequest ?? baseUrl, { ...options, ...search });
    return {
      result,
      showing: result.matches.length,
      value: formatPageSearch(result, search.pattern),
    };
  }
  const find = readFindElementsOptions(input);
  const result = await browserFindElements(proxyRequest ?? baseUrl, { ...options, ...find });
  return { result, showing: result.showing, value: formatPageFind(result, find.selector) };
}

/** Preserve every source-formatted result through the existing browser text trust boundary. */
export async function executePageInspectionAction(
  kind: "search" | "find",
  params: Parameters<typeof executeConsoleAction>[0],
): Promise<AgentToolResult<unknown>> {
  const requestedPage = readPositiveIntegerParam(params.input, "pageNumber") ?? 1;
  const pageSize = inspectionPageSize(params.input);
  const { result, showing, value } = await collectInspection(kind, params);
  const page = paginateBrowserText(value, pageSize, requestedPage);
  const wrapped = wrapBrowserExternalText({
    value: page.text,
    marker: "",
    includeWarning: true,
    prefix: inspectionPrefix(page),
    maxChars: Math.max(page.pageSize, page.text.length),
    mediaDirectivesNeutralized: true,
  });
  return textResult(wrapped.text, {
    ok: result.ok,
    targetId: result.targetId,
    url: result.url,
    total: result.total,
    showing,
    hasMoreResults: showing < result.total,
    currentPage: page.currentPage,
    totalPages: page.totalPages,
    hasMorePages: page.hasMorePages,
    pageSize: page.pageSize,
    outputTruncated: wrapped.truncated,
    externalContent: { untrusted: true, source: "browser", kind, wrapped: true },
  });
}
