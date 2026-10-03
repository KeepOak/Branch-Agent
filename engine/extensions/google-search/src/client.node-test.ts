import assert from "node:assert/strict";
import { test } from "node:test";
import { searchGoogle, type SearchRequest } from "./client.ts";

function fixture(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request: SearchRequest = async (url, init, read) => {
    calls.push({ url, init });
    return read(Response.json(body, { status }));
  };
  return { calls, request };
}
const options = { apiKey: "test-google-key", searchEngineId: "engine-123", query: "a & b/é" };

test("Google preserves upstream endpoint, query encoding, five-result default and raw JSON", async () => {
  const body = {
    items: [{ title: "One", link: "https://one.test", snippet: "Text" }],
    queries: { nextPage: [{ startIndex: 6 }] },
  };
  const f = fixture(body);
  assert.deepEqual(await searchGoogle(options, f.request), body);
  assert.equal(
    f.calls[0]?.url,
    "https://www.googleapis.com/customsearch/v1?key=test-google-key&cx=engine-123&q=a%20%26%20b%2F%C3%A9&num=5",
  );
  assert.deepEqual(f.calls[0]?.init, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
});

test("Google permits all ten upstream results and encodes configuration values", async () => {
  const f = fixture({ items: [] });
  await searchGoogle(
    { ...options, apiKey: "key&part", searchEngineId: "id&part", maxResults: 10 },
    f.request,
  );
  const url = new URL(f.calls[0]!.url);
  assert.equal(url.searchParams.get("key"), "key&part");
  assert.equal(url.searchParams.get("cx"), "id&part");
  assert.equal(url.searchParams.get("num"), "10");
});

test("Google reports the upstream error status and detail without reflecting the key", async () => {
  await assert.rejects(
    searchGoogle(options, fixture({ error: { message: "rejected test-google-key" } }, 403).request),
    /status 403: rejected \*\*\*/,
  );
});

test("Google preserves valid empty results and rejects malformed envelopes", async () => {
  assert.deepEqual(
    await searchGoogle(options, fixture({ searchInformation: { totalResults: "0" } }).request),
    { searchInformation: { totalResults: "0" } },
  );
  for (const body of [null, [], "unexpected"]) {
    await assert.rejects(searchGoogle(options, fixture(body).request), /Could not parse Google/);
  }
});

test("Google rejects invalid count before performing transport", async () => {
  const f = fixture({});
  for (const maxResults of [0, 11, 1.5, NaN]) {
    await assert.rejects(
      searchGoogle({ ...options, maxResults }, f.request),
      /integer from 1 to 10/,
    );
  }
  assert.equal(f.calls.length, 0);
});

test("Google propagates transport cancellation", async () => {
  const reason = new Error("caller canceled");
  const request: SearchRequest = async () => {
    throw reason;
  };
  await assert.rejects(searchGoogle(options, request), (error) => error === reason);
});
