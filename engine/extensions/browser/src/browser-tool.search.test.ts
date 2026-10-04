import { describe, expect, it, vi } from "vitest";
import type { BrowserProxyRequest } from "./browser-node-proxy.js";
import { applyBrowserTabToolBinding } from "./browser-tool-binding.js";
import { createBrowserToolDefinition } from "./browser-tool-description.js";
import { executeBrowserTabAction } from "./browser-tool-dispatch.js";
import { createBrowserToolSessionTabs } from "./browser-tool-session-tabs.js";
import {
  executePageInspectionAction,
  formatPageFind,
  formatPageSearch,
} from "./browser-tool.search.js";
import { paginateBrowserText } from "./browser/pw-page-markdown.js";
import type { PageSearchResult } from "./browser/pw-page-search.js";

function proxyFor(value: object) {
  return Object.assign(
    vi.fn(async () => ({ ok: true, targetId: "canonical", ...value })),
    {
      isHostFallbackActive: () => false,
      route: () => undefined,
    },
  ) as BrowserProxyRequest;
}

function bodyOf(result: Awaited<ReturnType<typeof executePageInspectionAction>>): string {
  const content = result.content.find((item) => item.type === "text");
  if (!content || content.type !== "text") {
    throw new Error("Expected tool text");
  }
  return content.text
    .split("Source: Browser\n---\n")[1]!
    .split(/\n<<<END_EXTERNAL_UNTRUSTED_CONTENT/)[0]!;
}

describe("search/find native browser tool caller", () => {
  it("is reachable through the default definition and run-bound schema", () => {
    const binding = {
      kind: "tab",
      tabId: 1,
      target: "host",
      profile: "branch",
      targetId: "pinned",
    } as const;
    for (const definition of [
      createBrowserToolDefinition(undefined, () => undefined),
      createBrowserToolDefinition({ runToolBinding: binding }, () => undefined),
    ]) {
      expect(definition.capabilities.actions).toEqual(expect.arrayContaining(["search", "find"]));
      expect((definition.metadata.parameters.properties.action as { enum?: unknown }).enum).toEqual(
        expect.arrayContaining(["search", "find"]),
      );
      expect(definition.metadata.description).toContain("contextChars (150)");
    }
    expect(
      applyBrowserTabToolBinding({ action: "search", pattern: "Widget" }, binding).targetId,
    ).toBe("pinned");
    expect(() =>
      applyBrowserTabToolBinding({ action: "find", selector: "a", targetId: "other" }, binding),
    ).toThrow("run-bound");
  });
  it("dispatches search through the real client projection and touches the resolved tab", async () => {
    const proxyRequest = proxyFor({
      total: 1,
      hasMore: false,
      matches: [{ matchText: "Widget", context: "A Widget", elementPath: "p", charPosition: 2 }],
    });
    const touched = vi.fn();
    const sessionTabs = createBrowserToolSessionTabs({
      defaultProfile: "branch",
      registry: {
        touchSessionBrowserTab: touched,
        trackSessionBrowserTab: vi.fn(),
        untrackSessionBrowserTab: vi.fn(),
      },
    });
    const result = await executeBrowserTabAction({
      action: "search",
      params: { pattern: "Widget", targetId: "alias" },
      profile: "branch",
      proxyRequest,
      sessionTabs,
      capabilities: createBrowserToolDefinition(undefined, () => undefined).capabilities,
      isUserBrowserProfile: false,
      onTabActivity: vi.fn(),
    });
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/search",
        method: "POST",
        profile: "branch",
        body: {
          pattern: "Widget",
          targetId: "alias",
          regex: false,
          caseSensitive: false,
          contextChars: 150,
          maxResults: 25,
        },
      }),
    );
    expect(touched).toHaveBeenCalledWith(expect.objectContaining({ targetId: "canonical" }));
    expect(result.details).toMatchObject({ total: 1, showing: 1, outputTruncated: false });
    expect(bodyOf(result)).toContain("[1] A Widget (in p)");
  });
  it("projects find options and preserves truthful total/showing", async () => {
    const proxyRequest = proxyFor({
      total: 4,
      showing: 2,
      elements: [
        { index: 0, tag: "tr", text: "Widget A", childrenCount: 3 },
        { index: 1, tag: "tr", text: "Widget B", childrenCount: 3 },
      ],
    });
    const result = await executePageInspectionAction("find", {
      input: { selector: "tr", maxResults: 2, includeText: false, attributes: ["href"] },
      proxyRequest,
      profile: "branch",
    });
    expect(proxyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/find",
        body: { selector: "tr", maxResults: 2, includeText: false, attributes: ["href"] },
      }),
    );
    expect(result.details).toMatchObject({ total: 4, showing: 2, hasMoreResults: true });
    expect(bodyOf(result)).toContain("Showing 2 of 4 total elements. Increase maxResults");
  });
  it("preserves long contexts once across every sanitized continuation", async () => {
    const context = `${"lead xMEDIA:/tmp/inline.png\nMEDIA:/tmp/private.png\n😀 <|endoftext|> tail\n".repeat(90)}`;
    const result: PageSearchResult = {
      total: 1,
      hasMore: false,
      matches: [{ matchText: "tail", context, elementPath: "p#long", charPosition: 0 }],
    };
    const proxyRequest = proxyFor(result);
    const first = await executePageInspectionAction("search", {
      input: { pattern: "tail", maxChars: 71 },
      proxyRequest,
    });
    const totalPages = (first.details as { totalPages: number }).totalPages;
    const parts: string[] = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const page = await executePageInspectionAction("search", {
        input: { pattern: "tail", maxChars: 71, pageNumber },
        proxyRequest,
      });
      expect(page.details).toMatchObject({
        currentPage: pageNumber,
        totalPages,
        outputTruncated: false,
        hasMorePages: pageNumber < totalPages,
      });
      expect(bodyOf(page)).not.toMatch(/(^|\n)[^\S\n]*MEDIA:/i);
      parts.push(bodyOf(page));
    }
    expect(parts.join("")).toBe(
      paginateBrowserText(formatPageSearch(result, "tail"), 100_000, 1).text,
    );
  });
  it("keeps the existing global envelope while retaining the source result count", async () => {
    const matches = Array.from({ length: 100 }, (_, index) => ({
      matchText: "x",
      context: `${index}:${"x".repeat(600)}`,
      elementPath: "p",
      charPosition: index,
    }));
    const result = await executePageInspectionAction("search", {
      input: { pattern: "x", maxResults: 100_000, contextChars: 100_000 },
      proxyRequest: proxyFor({ total: 100, matches, hasMore: false }),
    });
    expect(result.details).toMatchObject({
      total: 100,
      showing: 100,
      hasMoreResults: false,
      hasMorePages: true,
      outputTruncated: false,
    });
    const text = result.content.find((item) => item.type === "text");
    expect(text && text.type === "text" && text.text.length).toBeLessThanOrEqual(16_000);
  });
  it("formats upstream empty results, whitespace, and child counts", () => {
    expect(formatPageSearch({ total: 0, matches: [], hasMore: false }, "missing")).toBe(
      'No matches found for "missing" on page.',
    );
    expect(formatPageFind({ total: 0, elements: [], showing: 0 }, ".missing")).toBe(
      'No elements found matching ".missing".',
    );
    expect(
      formatPageFind(
        {
          total: 1,
          showing: 1,
          elements: [
            {
              index: 0,
              tag: "article",
              text: "hello\n world",
              attrs: { href: "/article" },
              childrenCount: 3,
            },
          ],
        },
        "article",
      ),
    ).toContain('[0] <article> "hello world" {href="/article"} (3 children)');
  });
});
