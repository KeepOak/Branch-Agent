# AGENT-LOOP-0030 — covered by existing production transport

Source: `openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31`.
Filtered clone `/tmp/upstream/openai-codex` is checked out at the pin.

The Codex client enables compression by default, selects zstd for OpenAI Codex-backend authentication, and leaves API-key requests as plain JSON. Branch's existing ChatGPT Responses provider already compresses HTTP bodies at zstd level 3; its API-key Responses provider sends ordinary JSON. No production file changed.

Both tests from `codex-rs/core/tests/suite/request_compression.rs` are ported to `engine/packages/ai/src/providers/request-compression.harvest.test.ts`. They keep their upstream names and all body/header assertions, wait for the production provider stream to complete, and additionally verify the decoded model and prompt. Each uses a real loopback HTTP server on an independently allocated port. The ChatGPT test uses a synthetic test JWT and the API-key test a fixture key; neither uses a live account. Branch's two provider adapters are the auth-routing equivalent of the upstream CodexAuth builder.

`cd engine && CI=1 node scripts/run-vitest.mjs run packages/ai/src/providers/request-compression.harvest.test.ts` — 1 file / 2 tests passed. The new file has its source header and COPIED.csv entry and is registered in the requested Harvest CI list. Screenshots: n/a; no visible behavior changed.

This verifies the cited enabled-compression tests. It does not assert parity for an upstream compression-disable feature flag, which Branch does not expose as the same Codex configuration switch.
