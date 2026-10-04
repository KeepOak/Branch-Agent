import assert from "node:assert/strict";
import { Socket } from "node:net";
import { afterEach, before, after, mock, test } from "node:test";
import { isMockedFetch } from "../../../src/infra/net/runtime-fetch.js";
import { runSerplySearch } from "./client.js";

const originalFetch = globalThis.fetch;
const key = "fixture serply/key?with=punctuation";
const cfg = (options: Record<string, unknown> = {}) => ({
  plugins: { entries: { serply: { config: { webSearch: { apiKey: key, ...options } } } } },
});
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
const row = {
  title: "Offline result",
  link: "https://example.org/page",
  description: "Offline snippet",
};
const calls: { url: string; init: RequestInit }[] = [];
function fixture(transport: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return await transport(String(input), init);
    },
    { mock: {} },
  ) as typeof fetch;
  assert.equal(isMockedFetch(globalThis.fetch), true);
}
before(() =>
  mock.method(Socket.prototype, "connect", () => {
    throw new Error("Offline fixture forbids native socket transport");
  }),
);
afterEach(() => {
  globalThis.fetch = originalFetch;
});
after(() => {
  mock.restoreAll();
});

test("actual host guard sends donor GET path, headers, query, count and locale options", async () => {
  fixture(() => json({ results: [row] }));
  const result = await runSerplySearch({
    cfg: cfg({ gl: "fr", hl: "fr", ignored: "x" }),
    query: "  padded query  ",
  });
  assert.equal(result.query, "padded query");
  assert.equal(result.total_results, 1);
  assert.equal(result.provider, "serply");
  const call = calls[0];
  assert.ok(call);
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, "https://api.serply.io/v1/search/");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "padded query",
    num: "5",
    gl: "fr",
    hl: "fr",
  });
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.body, undefined);
  assert.equal(new Headers(call.init.headers).get("x-api-key"), key);
  assert.equal(new Headers(call.init.headers).get("accept"), "application/json");
  assert.equal(new Headers(call.init.headers).get("user-agent"), "Branch");
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.equal(calls.length, 1);
  assert.ok(JSON.stringify(result).includes("EXTERNAL_UNTRUSTED_CONTENT"));
});

test("News uses entries, strips HTML and decodes entities, retaining source/date and donor cap", async () => {
  fixture(() =>
    json({
      entries: [
        null,
        ...Array.from({ length: 10 }, (_, i) => ({
          title: `Story ${i}`,
          link: `https://news.example.org/${i}`,
          summary: "<a>Genuine&nbsp;attention</a> &amp; chatbots",
          published: "Mon, 01 Jun 2026 08:00:00 GMT",
          source: { title: "Example Times" },
        })),
      ],
    }),
  );
  const result = await runSerplySearch({
    cfg: cfg({ vertical: " NEWS ", maxResults: 3 }),
    query: "q",
    count: 5,
  });
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/news/");
  assert.equal(new URL(calls[0]!.url).searchParams.get("num"), "3");
  assert.equal(result.total_results, 3);
  const first = (result.results as Record<string, unknown>[])[0]!;
  assert.ok(String(first.content).includes("Genuine\u00a0attention & chatbots"));
  assert.ok(String(first.source).includes("Example Times"));
  assert.ok(String(first.published).includes("Mon, 01 Jun 2026 08:00:00 GMT"));
  assert.ok(!String(first.content).includes("<a>"));
});

test("Scholar retains authors, citation count and PDF citation URL, with metadata defaults", async () => {
  fixture(() =>
    json({
      articles: [
        {
          ...row,
          author: { authors: [{ name: "A Vaswani" }, null, { name: "N Shazeer" }] },
          extras: { citations: { count: 120000 } },
          doc: { link: "https://arxiv.org/pdf/1706.03762" },
        },
        { title: "No metadata", link: "https://example.org/paper" },
      ],
    }),
  );
  const result = await runSerplySearch({
    cfg: cfg({ vertical: " Scholar " }),
    query: "transformers",
  });
  assert.equal(new URL(calls[0]!.url).pathname, "/v1/scholar/");
  const results = result.results as Record<string, unknown>[];
  assert.equal(results[0]!.cited_by, 120000);
  assert.equal(results[0]!.pdf_url, "https://arxiv.org/pdf/1706.03762");
  assert.ok(JSON.stringify(results[0]!.authors).includes("A Vaswani"));
  assert.ok(JSON.stringify(results[0]!.authors).includes("N Shazeer"));
  assert.deepEqual(results[1]!.authors, []);
  assert.equal(results[1]!.cited_by, 0);
  assert.equal(results[1]!.pdf_url, "");
  assert.equal(results[1]!.content, "");
});

test("query cap counts 500 Unicode code points and unknown vertical falls back to search", async () => {
  fixture(() => json({ results: [row] }));
  const result = await runSerplySearch({
    cfg: cfg({ vertical: "images", maxResults: 999 }),
    query: "😀".repeat(600),
  });
  const url = new URL(calls[0]!.url);
  assert.equal([...url.searchParams.get("q")!].length, 500);
  assert.equal([...String(result.query)].length, 500);
  assert.equal(url.searchParams.get("num"), "100");
  assert.equal(url.pathname, "/v1/search/");
});

test("malformed top-level/row shapes and missing/empty results retain safe donor errors", async () => {
  for (const payload of [
    ["not", "an", "object"],
    { results: "not-a-list" },
    { results: null },
    {},
    { results: [null, "x"] },
  ]) {
    fixture(() => json(payload));
    const result = await runSerplySearch({ cfg: cfg(), query: "q" });
    assert.ok(typeof result.error === "string");
    assert.match(result.error, /malformed JSON|unexpected response format|No results found/);
    assert.equal(calls.length, 1);
  }
});

test("actual bounded JSON reader rejects oversized body without buffering an unbounded provider stream", async () => {
  let cancelled = false;
  fixture(
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const result = await runSerplySearch({ cfg: cfg(), query: "q" });
  assert.match(String(result.error), /response exceeds/);
  assert.equal(cancelled, true);
});

test("HTTP failures discard reflected body and request IDs with actual credential context", async () => {
  fixture(
    () => new Response(`raw reflected ${key}`, { status: 403, headers: { "x-request-id": key } }),
  );
  const result = await runSerplySearch({ cfg: cfg(), query: "q" });
  assert.match(String(result.error), /Serply API error: HTTP 403/);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes("raw reflected"));
});

test("transport credentials redact raw, JSON and encoded forms before the donor diagnostic cap", async () => {
  const representation = [
    key,
    JSON.stringify(key).slice(1, -1),
    encodeURIComponent(key),
    new URLSearchParams({ v: key }).toString().slice(2),
  ];
  for (const reflected of representation) {
    fixture(() => {
      throw new Error(`prefix ${reflected} ${"z".repeat(490)} ${reflected}`);
    });
    const result = await runSerplySearch({ cfg: cfg(), query: `q ${key}` });
    assert.ok(!JSON.stringify(result).includes(reflected));
    assert.ok(String(result.error).includes("***"));
    assert.ok(!String(result.query).includes(key));
  }
});

test("malformed credential-bearing JSON omits parser causes and provider body text", async () => {
  fixture(() => new Response(`{"reflected":"${key}",invalid`));
  const result = await runSerplySearch({ cfg: cfg(), query: "q" });
  assert.match(String(result.error), /malformed JSON response/);
  assert.ok(!JSON.stringify(result).includes(key));
});

test("real guard strips credentials from cross-origin redirects and blocks private redirects before request", async () => {
  fixture((url) =>
    url.includes("api.serply.io")
      ? new Response(null, {
          status: 302,
          headers: { location: "https://public.example.org/search" },
        })
      : json({ results: [row] }),
  );
  await runSerplySearch({ cfg: cfg(), query: "q" });
  assert.equal(calls.length, 2);
  assert.equal(new Headers(calls[1]!.init.headers).get("x-api-key"), null);
  fixture(
    () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }),
  );
  const blocked = await runSerplySearch({ cfg: cfg(), query: "q" });
  assert.equal(calls.length, 1);
  assert.match(String(blocked.error), /blocked|private|https/i);
});

test("pre-abort and in-flight abort preserve the host caller cancellation reason", async () => {
  const pre = new AbortController();
  pre.abort(new Error("cancel before request"));
  fixture(() => {
    throw new Error("unexpected fetch");
  });
  await assert.rejects(
    runSerplySearch({ cfg: cfg(), query: "q", signal: pre.signal }),
    /cancel before request/,
  );
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  fixture(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        controller.abort(new Error("caller stopped"));
      }),
  );
  await assert.rejects(
    runSerplySearch({ cfg: cfg(), query: "q", signal: controller.signal }),
    /caller stopped/,
  );
});

test("parent abort cancels stalled JSON and HTTP error body reads", async () => {
  for (const status of [200, 403]) {
    const controller = new AbortController();
    let cancelled = false;
    fixture(
      () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode("{"));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        ),
    );
    const pending = runSerplySearch({ cfg: cfg(), query: "q", signal: controller.signal });
    setTimeout(() => controller.abort(new Error("body cancelled")), 10);
    await assert.rejects(pending, /body cancelled/);
    assert.equal(cancelled, true);
  }
});

test("donor 30-second guard deadline aborts actual pending transport", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let admitted!: () => void;
  const ready = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  fixture(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        admitted();
      }),
  );
  const pending = runSerplySearch({ cfg: cfg(), query: "q" });
  await ready;
  t.mock.timers.tick(29_999);
  assert.equal(calls[0]!.init.signal!.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(calls[0]!.init.signal!.aborted, true);
  const result = await pending;
  assert.match(String(result.error), /timed out/);
  t.mock.timers.reset();
});

test("News matches donor permissive HTML5 entity decoding exactly once", async () => {
  fixture(() =>
    json({ entries: [{ ...row, summary: "<b>&copy without semicolon &amp;lt; &#128; &#0;</b>" }] }),
  );
  const result = await runSerplySearch({ cfg: cfg({ vertical: "news" }), query: "q" });
  assert.ok(
    String((result.results as Record<string, unknown>[])[0]!.content).includes(
      "© without semicolon &lt; € �",
    ),
  );
});

test("missing credentials return host availability error without transport", async () => {
  const original = process.env.SERPLY_API_KEY;
  delete process.env.SERPLY_API_KEY;
  fixture(() => {
    throw new Error("unexpected transport");
  });
  try {
    const result = await runSerplySearch({ query: "q" });
    assert.deepEqual(result, {
      error: "missing_serply_api_key",
      message: "SERPLY_API_KEY is not configured",
      query: "q",
    });
    assert.equal(calls.length, 0);
  } finally {
    if (original === undefined) {
      delete process.env.SERPLY_API_KEY;
    } else {
      process.env.SERPLY_API_KEY = original;
    }
  }
});
