// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/basic-capabilities/evaluators/__tests__/link-extraction.test.ts.
// The preview fetch runs through the REAL SSRF guard over an injected transport;
// no real network, model or database.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureHarness } from "./capture-registration.test-support.js";
import { extractUrls, hasUrl, setLinkPreviewTransportForTests } from "./link-capture.js";

vi.mock("./memory-workspace-lock.js", () => ({
  withMemoryWorkspaceLock: async <T>(_workspaceDir: string, task: () => Promise<T>) => await task(),
}));

let workspaceDir: string;

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "link-capture-"));
});

afterEach(async () => {
  setLinkPreviewTransportForTests(undefined);
  await fs.rm(workspaceDir, { recursive: true, force: true });
});

function makeFetchResponse(
  body: string,
  { contentType = "text/html; charset=utf-8", ok = true } = {},
): Response {
  return new Response(body, { status: ok ? 200 : 500, headers: { "content-type": contentType } });
}

// A public pinned address so the guard's SSRF check passes and the injected
// transport (never the real network) serves the deterministic response.
const PINNED_LOOKUP = (async () => [{ address: "93.184.216.34", family: 4 }]) as never;

function stubPreviewFetch(body: string): ReturnType<typeof vi.fn> {
  const fetchImpl = vi.fn(async () => makeFetchResponse(body));
  setLinkPreviewTransportForTests({ lookupFn: PINNED_LOOKUP, fetchImpl });
  return fetchImpl;
}

async function receive(harness: ReturnType<typeof createCaptureHarness>, content: string, channelId = "telegram") {
  await harness.hook("message_received")(
    { from: "user-1", content, sessionKey: "agent:main:main" },
    { channelId, sessionKey: "agent:main:main" },
  );
}

async function readLinks(): Promise<string> {
  return await fs.readFile(path.join(workspaceDir, "memory", "links.md"), "utf8").catch(() => "");
}

describe("link capture", () => {
  it("detects URLs and dedupes with trailing punctuation stripped", () => {
    expect(hasUrl("hello there")).toBe(false);
    expect(hasUrl("check this https://example.com/x out")).toBe(true);
    expect(
      extractUrls("see https://a.example.com/page. also https://a.example.com/page (again)."),
    ).toEqual(["https://a.example.com/page"]);
  });

  it("summarizes a fetched page with the model and keeps a link memory", async () => {
    stubPreviewFetch(
      "<html><head><title>Example Domain &amp; Friends</title></head><body><p>This domain is for use in examples.</p></body></html>",
    );
    const harness = createCaptureHarness({
      workspaceDir,
      llmText: "Example Domain & Friends — a short page used for documentation examples.",
    });
    await receive(harness, "please check https://example.com/article and tell me");
    expect(harness.llmComplete).toHaveBeenCalledTimes(1);
    const prompt = (harness.llmComplete.mock.calls[0]?.[0] as { messages: Array<{ content: string }> })
      .messages[0]?.content;
    expect(prompt).toContain("https://example.com/article");
    expect(prompt).toContain("Title: Example Domain & Friends");
    const links = await readLinks();
    expect(links).toContain("https://example.com/article \"Example Domain & Friends\"");
    expect(links).toContain("a short page used for documentation examples.");
    expect(links).toContain("link, auto_capture, platform:telegram");
  });

  it("decodes title entities once and strips browser-tokenized raw-text tags", async () => {
    stubPreviewFetch(
      "<title>&amp;lt;literal&amp;gt;</title><body>safe<script>steal()</script:lookalike>still-script</sCrIpT data-x=1><style>hidden{}</style=lookalike>still-style</style/ignored><p>after</p><script>unclosed",
    );
    const harness = createCaptureHarness({ workspaceDir, llmText: "summary" });
    await receive(harness, "see https://example.com/hostile");
    const prompt = (harness.llmComplete.mock.calls[0]?.[0] as { messages: Array<{ content: string }> })
      .messages[0]?.content ?? "";
    expect(prompt).toContain("Title: &lt;literal&gt;");
    expect(prompt).toContain("safe");
    expect(prompt).not.toContain("steal()");
    expect(prompt).not.toContain("still-script");
    expect(prompt).not.toContain("hidden{}");
    expect(prompt).not.toContain("still-style");
    expect(prompt).not.toContain("unclosed");
    expect(prompt).toContain("after");
  });

  it("persists the URL even when the fetch fails, without a model call", async () => {
    setLinkPreviewTransportForTests({
      lookupFn: PINNED_LOOKUP,
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    const harness = createCaptureHarness({ workspaceDir, llmText: "should not be called" });
    await receive(harness, "look https://unreachable.test/page", "discord");
    expect(harness.llmComplete).not.toHaveBeenCalled();
    expect(await readLinks()).toContain(
      "- https://unreachable.test/page (link, auto_capture, platform:discord,",
    );
  });

  it("never fetches private targets through the SSRF guard", async () => {
    const fetchImpl = vi.fn(async () => makeFetchResponse("<title>secret</title>"));
    setLinkPreviewTransportForTests({
      lookupFn: (async () => [{ address: "127.0.0.1", family: 4 }]) as never,
      fetchImpl,
    });
    const harness = createCaptureHarness({ workspaceDir, llmText: "x" });
    await receive(harness, "internal http://intranet.example/admin");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readLinks()).toContain("- http://intranet.example/admin (link, auto_capture");
  });

  it("keeps the link when summarization fails", async () => {
    stubPreviewFetch("<html><title>doc</title><body>x</body></html>");
    const harness = createCaptureHarness({
      workspaceDir,
      llmText: async () => {
        throw new Error("model unavailable");
      },
    });
    await receive(harness, "shared https://example.com/d");
    expect(await readLinks()).toContain("- https://example.com/d — doc (link, auto_capture");
    expect(harness.warnings.some((warning) => warning.includes("link summarization failed"))).toBe(true);
  });

  it("respects the memory policy channel exclusion and the off switch", async () => {
    const fetchImpl = stubPreviewFetch("<title>doc</title>");
    const excluded = createCaptureHarness({
      workspaceDir,
      pluginConfig: { memoryPolicy: { excludeSessions: { channels: ["slack"] } } },
    });
    await receive(excluded, "https://example.com/a", "slack");
    const off = createCaptureHarness({ workspaceDir, pluginConfig: { linkCapture: { enabled: false } } });
    await receive(off, "https://example.com/b");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readLinks()).toBe("");
  });
});
