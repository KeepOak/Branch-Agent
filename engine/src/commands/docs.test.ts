// Docs command tests cover the docs homepage and local search over the docs bundled with the install.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const fetchMock = vi.fn<typeof fetch>();

vi.mock("../../packages/terminal-core/src/theme.js", () => ({
  isRich: () => false,
  theme: {
    heading: (s: string) => s,
    info: (s: string) => s,
    muted: (s: string) => s,
    command: (s: string) => s,
  },
}));

vi.mock("../../packages/terminal-core/src/links.js", () => ({
  formatDocsLink: (path: string, label?: string) => label ?? `${path}`,
}));

vi.mock("../cli/command-format.js", () => ({
  formatCliCommand: (s: string) => s,
}));

const { docsSearchCommand, searchBundledDocs } = await import("./docs.js");

const REPO_DOCS = "https://github.com/KeepOak/Branch-Agent/blob/main/engine/docs";

function writeDoc(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe("searchBundledDocs", () => {
  let root = "";

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-docs-search-"));
    writeDoc(root, "tools/web.md", "# Web search\n\nSearch the web with the configured provider.\n");
    writeDoc(root, "plugins/allowlist.md", "# Plugin allowlist\n\nOnly listed plugins load.\n");
    writeDoc(root, "gateway/security.md", "# Security\n\nA plugin can read the gateway token.\n");
    writeDoc(root, ".hidden/secret.md", "# Hidden\n\nplugin allowlist\n");
  });

  it("returns only pages that contain every query word, linked to the repo docs", () => {
    const results = searchBundledDocs("plugin allowlist", root);

    expect(results.map((result) => result.title)).toEqual(["Plugin allowlist"]);
    expect(results[0]?.link).toBe(`${REPO_DOCS}/plugins/allowlist.md`);
    // The snippet is the first line that holds the first query word.
    expect(results[0]?.snippet).toBe("# Plugin allowlist");
  });

  it("ranks a page whose title matches above one that only mentions the words", () => {
    const results = searchBundledDocs("plugin", root);

    expect(results.map((result) => result.title)).toEqual(["Plugin allowlist", "Security"]);
  });

  it("honours the result limit and returns nothing for an empty query", () => {
    expect(searchBundledDocs("plugin", root, 1)).toHaveLength(1);
    expect(searchBundledDocs("   ", root)).toEqual([]);
  });

  it("never reaches the network", () => {
    searchBundledDocs("plugin", root);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("docsSearchCommand", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("searches the bundled docs with no network request", async () => {
    const runtime = createTestRuntime();

    await docsSearchCommand(["plugin", "allowlist"], runtime, { json: true });

    expect(fetchMock).not.toHaveBeenCalled();
    const payload = JSON.parse(String(runtime.log.mock.calls[0]?.[0])) as {
      query: string;
      results: Array<{ link: string }>;
    };
    expect(payload.query).toBe("plugin allowlist");
    expect(payload.results.length).toBeGreaterThan(0);
    for (const result of payload.results) {
      expect(result.link.startsWith(REPO_DOCS)).toBe(true);
    }
  });

  it("emits one JSON object for the docs homepage", async () => {
    const runtime = createTestRuntime();

    await docsSearchCommand([], runtime, { json: true });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(runtime.log.mock.calls[0]?.[0]))).toEqual({
      query: null,
      url: "https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs",
      results: [],
    });
  });
});
