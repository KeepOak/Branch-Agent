/** Native ports of browser-use's pinned tests/ci/test_search_find.py. */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { BrowserContext, Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserTool } from "../browser-tool.js";
import { resolveBrowserConfig } from "./config.js";
import { getPlaywrightCore } from "./playwright-core.runtime.js";
import {
  findElementsViaPlaywright,
  searchPageViaPlaywright,
  readFindElementsOptions,
  readSearchPageOptions,
} from "./pw-page-search.js";
import { closePlaywrightBrowserConnection } from "./pw-session.js";
import { registerBrowserAgentDebugRoutes } from "./routes/agent.debug.js";
import { createBrowserRuntimeState, stopBrowserBridgeRuntime } from "./runtime-lifecycle.js";
import { createBrowserRouteContext } from "./server-context.js";
import { installBrowserCommonMiddleware } from "./server-middleware.js";
import { getFreePort } from "./test-port.js";

async function startNativeInspectionService(cdpUrl: string) {
  const app = express();
  installBrowserCommonMiddleware(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected isolated service port");
  }
  const state = await createBrowserRuntimeState({
    server,
    port: address.port,
    onWarn: () => {},
    resolved: resolveBrowserConfig({
      defaultProfile: "fixture",
      profiles: { fixture: { cdpUrl, attachOnly: true, color: "#112233" } },
    }),
  });
  const context = createBrowserRouteContext({
    getState: () => state,
    refreshConfigFromDisk: false,
  });
  registerBrowserAgentDebugRoutes(app, context);
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () =>
      stopBrowserBridgeRuntime({
        current: state,
        getState: () => state,
        clearState: () => {},
        closeServer: true,
        onWarn: () => {},
      }),
  };
}

const PRODUCTS = `<base href="http://127.0.0.1/products"><h1>Product Catalog</h1><div id="main"><table class="products">
<thead><tr><th>Name</th><th>Price</th><th>Rating</th></tr></thead><tbody>
<tr class="product-row"><td>Widget A</td><td>$29.99</td><td>4.5 stars</td></tr>
<tr class="product-row"><td>Widget B</td><td>$49.99</td><td>4.2 stars</td></tr>
<tr class="product-row"><td>Gadget C</td><td>$19.50</td><td>3.8 stars</td></tr>
<tr class="product-row"><td>Gadget D</td><td>$99.00</td><td>4.9 stars</td></tr></tbody></table>
<div class="pagination"><a href="/products?page=1" class="page-link active">1</a><a href="/products?page=2" class="page-link">2</a><a href="/products?page=3" class="page-link">3</a></div></div>
<footer id="footer"><p>Best price guarantee on all items.</p><p>Contact us at support@example.com</p></footer>`;

function browserLaunchEnvironment() {
  const env = { ...process.env };
  if (process.platform === "win32" && env.HOMEDRIVE && env.HOMEPATH) {
    env.USERPROFILE = path.join(env.HOMEDRIVE, env.HOMEPATH);
    env.HOME = env.USERPROFILE;
  }
  return env;
}

describe("search/find source defaults", () => {
  it("uses the exact pinned defaults without result ceilings", () => {
    expect(readSearchPageOptions({ pattern: "x" })).toEqual({
      pattern: "x",
      regex: false,
      caseSensitive: false,
      contextChars: 150,
      maxResults: 25,
    });
    expect(readFindElementsOptions({ selector: "a" })).toEqual({
      selector: "a",
      includeText: true,
      maxResults: 50,
    });
    expect(
      readSearchPageOptions({ pattern: "", maxResults: 100_000, contextChars: 100_000 }).maxResults,
    ).toBe(100_000);
  });
  it("rejects malformed input before page access", () => {
    expect(() => readSearchPageOptions({ pattern: 1 })).toThrow("pattern");
    expect(() => readSearchPageOptions({ pattern: "x", regex: "true" })).toThrow("regex");
    expect(() => readFindElementsOptions({ selector: "a", attributes: [1] })).toThrow("attributes");
    expect(() => readFindElementsOptions({ selector: "a", maxResults: 1.5 })).toThrow("maxResults");
  });
});

describe.runIf(process.env.BRANCH_BROWSER_SNAPSHOT_E2E === "1")(
  "native cheap page search/find (pinned browser-use regressions)",
  () => {
    let browser: BrowserContext;
    let page: Page;
    let profileDir: string;
    let target: { cdpUrl: string; targetId: string };
    let service: Awaited<ReturnType<typeof startNativeInspectionService>>;
    beforeAll(async () => {
      const root =
        process.env.BRANCH_TEST_ARTIFACT_DIR ?? path.join(os.tmpdir(), "Codex-session-files");
      await mkdir(root, { recursive: true });
      profileDir = await mkdtemp(path.join(root, "page-search-profile-"));
      const port = await getFreePort();
      browser = await getPlaywrightCore().chromium.launchPersistentContext(profileDir, {
        headless: true,
        timeout: 15_000,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: [`--remote-debugging-port=${port}`],
        env: browserLaunchEnvironment(),
      });
      page = browser.pages()[0] ?? (await browser.newPage());
      const session = await browser.newCDPSession(page);
      const { targetInfo } = await session.send("Target.getTargetInfo");
      await session.detach();
      target = { cdpUrl: `http://127.0.0.1:${port}`, targetId: targetInfo.targetId };
      service = await startNativeInspectionService(target.cdpUrl);
    });
    afterAll(async () => {
      try {
        await service?.stop();
        await closePlaywrightBrowserConnection();
      } finally {
        try {
          await browser?.close();
        } finally {
          if (profileDir) {
            await rm(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
          }
        }
      }
    });

    it("executes the default browser tool through its real client, guarded route, and own Chrome target", async () => {
      await page.setContent(PRODUCTS);
      const tool = createBrowserTool({
        sandboxBridgeUrl: service.baseUrl,
        allowHostControl: false,
      });
      const options = { target: "sandbox", targetId: target.targetId };
      const search = await tool.execute("native-search", {
        ...options,
        action: "search",
        pattern: "Widget",
        maxResults: 1,
      });
      expect(search.details).toMatchObject({
        total: 2,
        showing: 1,
        hasMoreResults: true,
        outputTruncated: false,
      });
      expect(search.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("Found 2 matches"),
          }),
        ]),
      );
      const find = await tool.execute("native-find", {
        ...options,
        action: "find",
        selector: "tr.product-row",
        attributes: ["class"],
      });
      expect(find.details).toMatchObject({ total: 4, showing: 4, outputTruncated: false });
      expect(find.details).toHaveProperty("targetId", target.targetId);
      expect(find.details).not.toHaveProperty("browserTab");
    });

    it("finds literal text with context and the containing element path", async () => {
      await page.setContent(PRODUCTS);
      const result = await searchPageViaPlaywright({ ...target, pattern: "Widget A" });
      expect(result.total).toBe(1);
      expect(result.matches[0]).toMatchObject({
        matchText: "Widget A",
        context: expect.stringContaining("$29.99"),
        elementPath: "div#main > table.products > tbody > tr.product-row > td",
      });
      expect(result.matches[0]!.charPosition).toBeGreaterThan(0);
    });
    it("counts all regex prices while returning only the requested matches", async () => {
      await page.setContent(PRODUCTS);
      const result = await searchPageViaPlaywright({
        ...target,
        pattern: String.raw`\$\d+\.\d{2}`,
        regex: true,
        maxResults: 2,
      });
      expect(result).toMatchObject({ total: 4, hasMore: true });
      expect(result.matches.map((match) => match.matchText)).toEqual(["$29.99", "$49.99"]);
    });
    it("scopes search and reports a missing scope", async () => {
      await page.setContent(PRODUCTS);
      expect(
        await searchPageViaPlaywright({ ...target, pattern: "price", cssScope: "#footer" }),
      ).toMatchObject({ total: 1 });
      await expect(
        searchPageViaPlaywright({ ...target, pattern: "x", cssScope: "#nonexistent" }),
      ).rejects.toThrow("scope selector not found");
    });
    it("is case-insensitive by default and supports exact case", async () => {
      await page.setContent(
        "<p>The Quick Brown Fox jumps.</p><p>QUICK BROWN FOX is uppercase.</p><p>quick brown fox is lowercase.</p>",
      );
      expect(
        await searchPageViaPlaywright({ ...target, pattern: "quick brown fox" }),
      ).toMatchObject({ total: 3 });
      expect(
        await searchPageViaPlaywright({
          ...target,
          pattern: "QUICK BROWN FOX",
          caseSensitive: true,
        }),
      ).toMatchObject({ total: 1 });
    });
    it("returns no matches cleanly and advances zero-length regex matches", async () => {
      await page.setContent("<p>abc</p>");
      expect(await searchPageViaPlaywright({ ...target, pattern: "missing" })).toEqual({
        matches: [],
        total: 0,
        hasMore: false,
      });
      expect(await searchPageViaPlaywright({ ...target, pattern: "", regex: true })).toMatchObject({
        total: 4,
      });
      expect(
        await searchPageViaPlaywright({ ...target, pattern: ".", regex: false }),
      ).toMatchObject({ total: 0 });
      await expect(
        searchPageViaPlaywright({ ...target, pattern: "[", regex: true }),
      ).rejects.toThrow("regular expression");
    });
    it("queries rows and reports total/showing without an invented ceiling", async () => {
      await page.setContent(PRODUCTS);
      const result = await findElementsViaPlaywright({
        ...target,
        selector: "tr.product-row",
        maxResults: 2,
      });
      expect(result).toMatchObject({ total: 4, showing: 2 });
      expect(result.elements[0]).toMatchObject({
        index: 0,
        tag: "tr",
        text: "Widget A$29.994.5 stars",
        childrenCount: 3,
      });
      expect(
        await findElementsViaPlaywright({
          ...target,
          selector: "tr.product-row",
          maxResults: 100_000,
        }),
      ).toMatchObject({ total: 4, showing: 4 });
    });
    it("extracts attributes with resolved URLs and omits missing attributes", async () => {
      await page.setContent(PRODUCTS);
      const result = await findElementsViaPlaywright({
        ...target,
        selector: "div.pagination > a",
        attributes: ["href", "class", "missing"],
      });
      expect(result).toMatchObject({ total: 3, showing: 3 });
      expect(result.elements[0]?.attrs).toEqual({
        href: "http://127.0.0.1/products?page=1",
        class: "page-link active",
      });
      await page.setContent('<base href="http://127.0.0.1/"><img src="/product.jpg">');
      expect(
        (await findElementsViaPlaywright({ ...target, selector: "img", attributes: ["src"] }))
          .elements[0]?.attrs,
      ).toEqual({ src: "http://127.0.0.1/product.jpg" });
    });
    it("supports nested selectors, includeText=false, and children counts", async () => {
      await page.setContent(
        '<article><h2>Introduction</h2><p>Text</p><a href="/python" class="read-more">Read more</a></article><article><a class="read-more" href="/css">CSS</a></article>',
      );
      const articles = await findElementsViaPlaywright({
        ...target,
        selector: "article",
        includeText: false,
      });
      expect(articles.elements[0]).toEqual({ index: 0, tag: "article", childrenCount: 3 });
      expect(
        await findElementsViaPlaywright({ ...target, selector: "article a.read-more" }),
      ).toMatchObject({ total: 2 });
    });
    it("returns clean empty results and clear invalid-selector errors", async () => {
      await page.setContent(PRODUCTS);
      expect(await findElementsViaPlaywright({ ...target, selector: ".nonexistent" })).toEqual({
        elements: [],
        total: 0,
        showing: 0,
      });
      await expect(
        findElementsViaPlaywright({ ...target, selector: "[[[invalid" }),
      ).rejects.toThrow("selector");
      expect(
        await findElementsViaPlaywright({ ...target, selector: "tr", maxResults: 0 }),
      ).toMatchObject({ total: 5, showing: 0 });
    });
    it("retains upstream text/attribute truncation and does not mutate the DOM", async () => {
      await page.setContent(`<div data-long="${"a".repeat(700)}">${"text ".repeat(100)}</div>`);
      const original = await page.content();
      const result = await findElementsViaPlaywright({
        ...target,
        selector: "div",
        attributes: ["data-long"],
      });
      expect(result.elements[0]!.text).toHaveLength(303);
      expect(result.elements[0]!.attrs!["data-long"]).toHaveLength(503);
      expect(await page.content()).toBe(original);
    });
    it("safely passes quoted selectors/patterns and honors pre-aborted callers", async () => {
      await page.setContent('<p data-name="quote">A "; throw new Error() // B</p>');
      expect(
        await searchPageViaPlaywright({ ...target, pattern: '"; throw new Error() //' }),
      ).toMatchObject({ total: 1 });
      expect(
        await findElementsViaPlaywright({ ...target, selector: '[data-name="quote"]' }),
      ).toMatchObject({ total: 1 });
      const controller = new AbortController();
      controller.abort(new Error("test cancellation"));
      await expect(
        searchPageViaPlaywright({ ...target, pattern: "x", signal: controller.signal }),
      ).rejects.toThrow("test cancellation");
    });
  },
);
