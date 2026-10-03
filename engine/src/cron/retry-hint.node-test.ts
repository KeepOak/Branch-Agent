import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCronExecutionRetryHint } from "./retry-hint.js";

test("versioned HTTP responses and status-code spellings classify server retries", () => {
  for (const error of ["HTTP/1.1 503", "HTTP/2 502", "status-code: 504", "response-code=500"]) {
    assert.deepEqual(resolveCronExecutionRetryHint({ error }), { retryable: true, category: "server_error" });
  }
});

test("incidental process numbers and authoritative permanent reasons remain permanent", () => {
  for (const error of ["command exited with 503 lines", "context limit 512 exceeded", "pid 511 killed"]) {
    assert.deepEqual(resolveCronExecutionRetryHint({ error }), { retryable: false });
  }
  assert.deepEqual(resolveCronExecutionRetryHint({ error: "HTTP/1.1 503", classifiedReason: "auth" }), { retryable: false });
  assert.deepEqual(resolveCronExecutionRetryHint({ error: "HTTP/1.1 503", retryOn: ["timeout"] }), { retryable: false });
});
