// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/__tests__/utils/extensions/Confluence/ConfluenceLoader.test.js,
// collector/__tests__/extensions/resync/paperless.resync.test.js, server/__tests__/models/documentSyncQueue.test.js.
// Drives the `wiki connector` CLI against fake instance APIs (the SSRF-guarded fetch is replaced).
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWikiCli } from "../cli.js";
import type { ResolvedMemoryWikiConfig } from "../config.js";
import { parseWikiMarkdown } from "../markdown.js";
import { createMemoryWikiTestHarness } from "../test-helpers.js";
import { ConfluencePagesLoader, resolveConfluenceBaseUrl } from "./confluence.js";
import type { ConnectorFetch } from "./fetch.js";
import {
  DEFAULT_STALE_AFTER_MS,
  readConnectorSources,
  resolveDefaultStaleAfterMs,
  resyncConnectorSources,
  runConnectorImport,
} from "./sources.js";

const fakeApi = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string, init?: RequestInit) => Promise<Response>),
  allowedBaseUrls: [] as Array<string | undefined>,
}));

vi.mock("./fetch.js", () => ({
  createGuardedConnectorFetch: (allowedBaseUrl?: string) => {
    fakeApi.allowedBaseUrls.push(allowedBaseUrl);
    return async (url: string, init?: RequestInit) => {
      if (!fakeApi.handler) {
        throw new Error("no fake api");
      }
      return await fakeApi.handler(url, init);
    };
  },
}));

const { createVault } = createMemoryWikiTestHarness();
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers });

let rootDir = "";
let config: ResolvedMemoryWikiConfig;
let output = "";

async function wikiCli(...args: string[]): Promise<string> {
  output = "";
  const program = new Command();
  program.name("test");
  registerWikiCli(program, { config });
  await program.parseAsync(["wiki", ...args], { from: "user" });
  return output;
}

async function sourcePages(): Promise<Array<{ file: string; raw: string }>> {
  const dir = path.join(rootDir, "sources");
  // sources/index.md is the compiled index, not an imported page.
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter(
    (file) => file.endsWith(".md") && file !== "index.md",
  );
  return await Promise.all(
    files.toSorted().map(async (file) => ({ file, raw: await fs.readFile(path.join(dir, file), "utf8") })),
  );
}

async function vaultText(): Promise<string> {
  const chunks: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        chunks.push(await fs.readFile(absolute, "utf8"));
      }
    }
  };
  await walk(rootDir);
  return chunks.join("\n");
}

function giteaRepo(files: Record<string, string>) {
  return async (url: string): Promise<Response> => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/user") {
      return json({ login: "tester" });
    }
    if (pathname.endsWith("/branches")) {
      return json(Number(searchParams.get("page")) === 1 ? [{ name: "main" }] : []);
    }
    if (pathname.includes("/git/trees/")) {
      const tree = Object.keys(files).map((file) => ({ type: "blob", path: file }));
      return json({ tree: Number(searchParams.get("page")) === 1 ? tree : [], truncated: false });
    }
    if (pathname.includes("/raw/")) {
      const file = decodeURIComponent(pathname.split("/raw/")[1] ?? "");
      return file in files ? new Response(files[file]) : new Response("", { status: 404 });
    }
    return json({ default_branch: "main" });
  };
}

beforeEach(async () => {
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  fakeApi.handler = undefined;
  fakeApi.allowedBaseUrls = [];
  ({ rootDir, config } = await createVault({ initialize: true, prefix: "memory-wiki-connectors-" }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

describe("wiki connector repo", () => {
  it("imports repository files as source pages, never storing the token, and prunes removed files", async () => {
    vi.stubEnv("TEST_GITEA_TOKEN", "pat_secret_value");
    const files: Record<string, string> = {
      "README.md": "# Widgets\nHow widgets work.",
      "docs/guide.md": "Turn the crank.",
      "packages/a/README.md": "Package A readme",
    };
    fakeApi.handler = giteaRepo(files);
    const first = await wikiCli(
      "connector",
      "repo",
      "https://git.example.com/acme/widgets",
      "--platform",
      "gitea",
      "--token-env",
      "TEST_GITEA_TOKEN",
      "--watch",
    );
    expect(first).toContain("3 new");
    expect(fakeApi.allowedBaseUrls).toContain("https://git.example.com/acme/widgets");
    const pages = await sourcePages();
    expect(pages).toHaveLength(3);
    const readme = pages.find((page) => page.raw.includes("How widgets work."));
    const frontmatter = parseWikiMarkdown(readme?.raw ?? "").frontmatter;
    expect(frontmatter).toMatchObject({
      pageType: "source",
      sourceType: "gitea",
      connectorSource: "gitea:https://git.example.com/acme/widgets@main",
      sourcePath: "https://git.example.com/acme/widgets/src/branch/main/README.md",
    });
    expect(await vaultText()).not.toContain("pat_secret_value");
    const [record] = await readConnectorSources(config);
    expect(record).toMatchObject({ watched: true, staleAfterMs: DEFAULT_STALE_AFTER_MS });
    expect(record?.spec).toMatchObject({ tokenEnv: "TEST_GITEA_TOKEN" });

    delete files["docs/guide.md"];
    const second = await wikiCli("connector", "repo", "https://git.example.com/acme/widgets", "--platform", "gitea");
    expect(second).toContain("0 new, 0 updated, 2 unchanged, 1 removed");
    expect((await sourcePages()).some((page) => page.raw.includes("Turn the crank."))).toBe(false);
  });

  it("reports a repository that cannot be prepared", async () => {
    fakeApi.handler = async () => new Response("", { status: 404 });
    expect(await wikiCli("connector", "repo", "https://git.example.com/acme", "--platform", "gitea")).toContain(
      "Connector import failed: Could not prepare Gitea repo for loading! Check URL",
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("wiki connector link and obsidian", () => {
  it("imports a web page as markdown with its title", async () => {
    fakeApi.handler = async () =>
      new Response(
        "<html><head><title>Widget Guide</title></head><body><h1>Widgets</h1><p>Turn the <b>crank</b>.</p></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    expect(await wikiCli("connector", "link", "docs.example.com/guide/")).toContain(
      "link:https://docs.example.com/guide",
    );
    const [page] = await sourcePages();
    expect(parseWikiMarkdown(page?.raw ?? "").frontmatter.title).toBe("Widget Guide");
    expect(page?.raw).toContain("Turn the");
    expect(fakeApi.allowedBaseUrls).toEqual([undefined]);
  });

  it("imports an Obsidian vault's notes, skipping empty notes and dot folders", async () => {
    const vault = path.join(rootDir, "..", `${path.basename(rootDir)}-obsidian`, "My Vault");
    await fs.mkdir(path.join(vault, "Projects"), { recursive: true });
    await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
    await fs.writeFile(path.join(vault, "Projects", "Plan.md"), "# Plan\nShip it.");
    await fs.writeFile(path.join(vault, "Empty.md"), "   \n");
    await fs.writeFile(path.join(vault, ".obsidian", "app.md"), "settings");
    try {
      expect(await wikiCli("connector", "obsidian", vault)).toContain("1 new");
      const [page] = await sourcePages();
      expect(page?.raw).toContain("Ship it.");
      expect(parseWikiMarkdown(page?.raw ?? "").frontmatter.sourcePath).toBe(
        "obsidian://My Vault/Projects/Plan.md",
      );
    } finally {
      await fs.rm(path.dirname(vault), { recursive: true, force: true });
    }
  });
});

describe("Confluence connector", () => {
  it("resolves cloud and self-hosted base urls", () => {
    expect(resolveConfluenceBaseUrl("https://example.atlassian.net/wiki/spaces/SP", true)).toBe(
      "https://example.atlassian.net",
    );
    expect(resolveConfluenceBaseUrl("https://my.domain.com/confluence/", false)).toBe(
      "https://my.domain.com/confluence",
    );
    expect(resolveConfluenceBaseUrl("https://my.domain.com/", false)).toBe("https://my.domain.com");
  });

  it("preserves code blocks when the macro id precedes the name", () => {
    const loader = new ConfluencePagesLoader({
      baseUrl: "https://example.com",
      spaceKey: "SP",
      cloud: false,
      fetchImpl: vi.fn<ConnectorFetch>(),
    });
    const document = loader.createDocumentFromPage({
      id: "123",
      title: "Code",
      body: {
        storage: {
          value:
            '<ac:structured-macro ac:macro-id="example" ac:name="code" ac:schema-version="1"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[let x = 1;]]></ac:plain-text-body></ac:structured-macro>',
        },
      },
    });
    expect(document.pageContent).toBe("\n```js\nlet x = 1;\n```\n");
  });

  it("imports a cloud space through the /wiki API with basic auth from the token env", async () => {
    vi.stubEnv("TEST_CONFLUENCE_TOKEN", "atl_secret");
    const requests: Array<{ url: string; auth?: string }> = [];
    fakeApi.handler = async (url, init) => {
      requests.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      const start = Number(new URL(url).searchParams.get("start"));
      return json(
        start === 0
          ? {
              size: 1,
              results: [
                {
                  id: "42",
                  title: "Runbook",
                  body: { storage: { value: "<p>Restart the <em>service</em>.</p>" } },
                  version: { number: 3, by: { displayName: "Ann" }, when: "2026-01-02T03:04:05Z" },
                },
              ],
            }
          : { size: 0, results: [] },
      );
    };
    await wikiCli(
      "connector",
      "confluence",
      "--base-url",
      "https://example.atlassian.net/wiki/spaces/SP",
      "--space-key",
      "SP",
      "--username",
      "ann@example.com",
      "--token-env",
      "TEST_CONFLUENCE_TOKEN",
    );
    expect(requests[0]?.url).toBe(
      "https://example.atlassian.net/wiki/rest/api/content?spaceKey=SP&limit=25&start=0&expand=body.storage,version",
    );
    expect(requests[0]?.auth).toBe(
      `Basic ${Buffer.from("ann@example.com:atl_secret").toString("base64")}`,
    );
    const [page] = await sourcePages();
    expect(page?.raw).toContain("Restart the");
    expect(parseWikiMarkdown(page?.raw ?? "").frontmatter.sourcePath).toBe(
      "https://example.atlassian.net/wiki/spaces/SP/pages/42",
    );
    expect(await vaultText()).not.toContain("atl_secret");
  });

  it("refuses to run without credentials", async () => {
    expect(
      await wikiCli("connector", "confluence", "--base-url", "https://x.example", "--space-key", "SP", "--token-env", "UNSET_TEST_TOKEN"),
    ).toContain("You need either a personal access token (PAT), or a username and access token");
  });
});

describe("Paperless-ngx and DrupalWiki connectors", () => {
  it("imports Paperless-ngx documents, keeping a context path and using extracted text for PDFs", async () => {
    vi.stubEnv("TEST_PAPERLESS_TOKEN", "pl_secret");
    const urls: string[] = [];
    fakeApi.handler = async (url, init) => {
      urls.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Token pl_secret");
      if (url.endsWith("/api/documents/")) {
        return json({
          next: null,
          results: [
            { id: 1, original_file_name: "notes.txt", modified: "2026-01-01T00:00:00Z" },
            { id: 2, original_file_name: "invoice.pdf", content: "Invoice total 42 EUR" },
          ],
        });
      }
      if (url.includes("/documents/1/download/")) {
        return new Response("plain notes", { headers: { "content-type": "text/plain" } });
      }
      return new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
    };
    await wikiCli(
      "connector",
      "paperless",
      "--base-url",
      "https://docs.example.com/paperless/",
      "--token-env",
      "TEST_PAPERLESS_TOKEN",
    );
    expect(urls).toContain("https://docs.example.com/paperless/api/documents/1/download/");
    const text = (await sourcePages()).map((page) => page.raw).join("\n");
    expect(text).toContain("plain notes");
    expect(text).toContain("Invoice total 42 EUR");
    expect(await vaultText()).not.toContain("pl_secret");
  });

  it("imports DrupalWiki pages of every listed space, using the title for an empty body", async () => {
    vi.stubEnv("DRUPALWIKI_API_TOKEN", "dw_secret");
    fakeApi.handler = async (url) => {
      const { pathname, searchParams } = new URL(url);
      if (pathname.endsWith("/api/rest/scope/api/page")) {
        const space = searchParams.get("space");
        return json({ content: space === "21" ? [{ id: 5 }, { id: 6 }] : [{ id: 7 }], last: true });
      }
      const id = Number(pathname.split("/").pop());
      return json({
        id,
        title: `Page ${id}`,
        lastModified: "2026-02-01T00:00:00Z",
        body: id === 6 ? "  " : `<p>Body of ${id}</p>`,
      });
    };
    await wikiCli("connector", "drupalwiki", "--base-url", "https://wiki.example.com", "--space-ids", "21, 56");
    const pages = await sourcePages();
    expect(pages.map((page) => parseWikiMarkdown(page.raw).frontmatter.title).toSorted()).toEqual([
      "Page 5",
      "Page 6",
      "Page 7",
    ]);
    expect(pages.map((page) => page.raw).join("\n")).toContain("Body of 5");
  });
});

describe("connector resync", () => {
  it("defaults the stale window to 7 days, clamps to 1 hour, and ignores bad values", () => {
    expect(resolveDefaultStaleAfterMs({})).toBe(604_800_000);
    expect(resolveDefaultStaleAfterMs({ DOCUMENT_SYNC_STALE_AFTER_MS: "86400000" })).toBe(86_400_000);
    expect(resolveDefaultStaleAfterMs({ DOCUMENT_SYNC_STALE_AFTER_MS: "60000" })).toBe(3_600_000);
    expect(resolveDefaultStaleAfterMs({ DOCUMENT_SYNC_STALE_AFTER_MS: "not-a-number" })).toBe(604_800_000);
    expect(resolveDefaultStaleAfterMs({ DOCUMENT_SYNC_STALE_AFTER_MS: "-5000" })).toBe(604_800_000);
  });

  it("re-syncs a watched source only when stale, updating changed pages", async () => {
    const files: Record<string, string> = { "README.md": "version one" };
    fakeApi.handler = giteaRepo(files);
    let now = 1_000_000;
    const runtime = { now: () => now, env: {} };
    await runConnectorImport({
      config,
      spec: { kind: "gitea", repo: "https://git.example.com/acme/widgets" },
      watch: true,
      runtime,
    });
    files["README.md"] = "version two";

    expect((await resyncConnectorSources({ config, runtime })).checked).toBe(0);
    now += DEFAULT_STALE_AFTER_MS;
    const due = await resyncConnectorSources({ config, runtime });
    expect(due.synced).toEqual([
      expect.objectContaining({ updatedCount: 1, importedCount: 0, removedCount: 0 }),
    ]);
    expect((await sourcePages())[0]?.raw).toContain("version two");
    expect((await readConnectorSources(config))[0]?.nextSyncAt).toBe(now + DEFAULT_STALE_AFTER_MS);
  });

  it("stops watching a source after it keeps failing", async () => {
    fakeApi.handler = giteaRepo({ "README.md": "hello" });
    await runConnectorImport({
      config,
      spec: { kind: "gitea", repo: "https://git.example.com/acme/widgets" },
      watch: true,
    });
    fakeApi.handler = async () => new Response("", { status: 500 });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await wikiCli("connector", "resync", "--all");
      expect(result).toContain(`attempt ${attempt}`);
    }
    expect(await wikiCli("connector", "resync", "--all")).toContain("no longer watched");
    expect((await readConnectorSources(config))[0]?.watched).toBe(false);
    expect((await sourcePages())[0]?.raw).toContain("hello");
  });

  it("does not watch connectors without an upstream resync handler", async () => {
    const result = await runConnectorImport({ config, spec: { kind: "obsidian", path: rootDir }, watch: true });
    expect(result).toEqual({ success: false, reason: "obsidian sources cannot be watched for resync." });
  });
});
