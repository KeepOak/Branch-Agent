# AGENT-LOOP-0029 — blocked

Source: `openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31`.
Filtered clone `/tmp/upstream/openai-codex` is checked out at the pin.

Codex keeps a turn-scoped cached/prewarmed Responses WebSocket and switches the session to HTTP when connection/stream retries are exhausted. The cited suites verify request reuse/continuation, headers, cache invalidation, reconnects, startup prewarming, special handling of HTTP 426, retry visibility, and sticky fallback across turns.

Branch already caches Responses sockets and provides sticky authority-scoped SSE fallback. Its transport code has no startup Responses prewarm path. The pinned `websocket_fallback.rs` explicitly asserts one startup attempt plus three streaming attempts when the configured retry count is two; its 426 case asserts immediate fallback after the single prewarm attempt. Existing cache/fallback tests cannot be substituted for those assertions, and 0/3 cited upstream test files have been ported. This row is not marked covered.

A complete port needs the prewarm/retry integration into Branch's admitted native transport lifecycle and all three upstream suites, with the missing atlas owner/page-41 instructions governing the added request path. Named verification of the existing Branch transport is recorded in the status CSV; it is not counted as an upstream test port.

Verification: `cd engine && CI=1 node scripts/run-vitest.mjs run packages/ai/src/providers/openai-chatgpt-responses.cache.test.ts packages/ai/src/transports/openai-responses-websocket.test.ts --reporter=verbose` — 2 files / 32 tests passed. The shell needs network access enabled for local socket tests. Initial sandboxed launches exited 1 without Vitest output; the same named files passed with local networking available. Both existing files are registered in the Harvest CI list, unchanged.
