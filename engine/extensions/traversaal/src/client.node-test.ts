import assert from "node:assert/strict";
import { test } from "node:test";
import { searchTraversaal, type SearchRequest } from "./client.ts";

function fixture(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request: SearchRequest = async (url, init, read) => {
    calls.push({ url, init });
    return read(Response.json(body, { status }));
  };
  return { calls, request };
}
const options = { apiKey: "test-traversaal-key", query: "Find the highest mountains." };

test("Traversaal preserves the upstream POST, API header, sentence-array body and source formatting", async () => {
  const f = fixture({
    data: { response_text: "Everest", web_url: ["https://one.test", "https://two.test"] },
  });
  assert.deepEqual(await searchTraversaal(options, f.request), {
    content: "Everest\n\nSources:\n - https://one.test\n - https://two.test",
    citations: ["https://one.test", "https://two.test"],
  });
  assert.equal(f.calls[0]?.url, "https://api-ares.traversaal.ai/live/predict");
  assert.deepEqual(f.calls[0]?.init, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-traversaal-key" },
    body: '{"query":["Find the highest mountains."]}',
  });
});

test("Traversaal preserves text-only and source-only responses", async () => {
  assert.deepEqual(
    await searchTraversaal(options, fixture({ data: { response_text: "Text only" } }).request),
    { content: "Text only", citations: [] },
  );
  assert.deepEqual(
    await searchTraversaal(options, fixture({ data: { web_url: ["https://one.test"] } }).request),
    { content: "\n\nSources:\n - https://one.test", citations: ["https://one.test"] },
  );
});

test("Traversaal preserves the original empty-results message", async () => {
  assert.deepEqual(await searchTraversaal(options, fixture({ data: {} }).request), {
    content: "No response found in Traversaal API results",
    citations: [],
  });
});

test("Traversaal rejects missing or malformed response envelopes", async () => {
  for (const body of [{}, { data: null }, { data: [] }, null, []]) {
    await assert.rejects(
      searchTraversaal(options, fixture(body).request),
      /Could not parse Traversaal/,
    );
  }
});

test("Traversaal reports error/message fallback and redacts the key", async () => {
  await assert.rejects(
    searchTraversaal(options, fixture({ error: "denied test-traversaal-key" }, 401).request),
    /status code 401: denied \*\*\*/,
  );
  await assert.rejects(
    searchTraversaal(options, fixture({ message: "quota" }, 429).request),
    /status code 429: quota/,
  );
});

test("Traversaal handles unexpected field types and propagates transport cancellation", async () => {
  assert.deepEqual(
    await searchTraversaal(
      options,
      fixture({ data: { response_text: 12, web_url: [42, "https://one.test"] } }).request,
    ),
    { content: "\n\nSources:\n - https://one.test", citations: ["https://one.test"] },
  );
  const reason = new Error("caller canceled");
  const request: SearchRequest = async () => {
    throw reason;
  };
  await assert.rejects(searchTraversaal(options, request), (error) => error === reason);
});
