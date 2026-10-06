# AGENT-LOOP-0027 — blocked

Source: `anomalyco/opencode@aa481b8f5652f5576c55f914a64ed270e7daa7e0`.
Filtered clone `/tmp/upstream/anomalyco-opencode` is checked out at the pin.

The dispatcher selects an opt-in supported native request path, otherwise streams through the AI SDK and translates that stream into the same LLM event contract. Tests cover provider/request selection, native compatibility boundaries, wire payloads, tool/usage/error translation, and recorded provider parity.

The cited files import `ai`, `effect`, `@opencode-ai/llm`, core provider/session/auth services, and permission/plugin/request preparation. Branch already has its own native provider runtime and authority-scoped host but no AI SDK fallback. The pinned services and SDK packages are absent from its frozen dependency graph. The recorded tests require the upstream HTTP recorder and fixture/provider/service layer. No separate unchecked request path or duplicate permission implementation was added.

Completing that integration requires resolving the missing dependency/runtime seam while preserving Branch's existing admitted request authority. The task prohibits lockfile changes, and the owner atlas/page-41 instructions needed to approve the mapping are not in this checkout. 0/2 cited test files ported; no test command run.
