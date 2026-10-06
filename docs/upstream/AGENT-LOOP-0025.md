# AGENT-LOOP-0025 — blocked

Source: `mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421`.
The filtered clone is `/tmp/upstream/mastra-ai-mastra`; its checked-out HEAD matches the pin.

The conversion registers an AI SDK v6 ToolLoopAgent as a Mastra Agent. Its processor carries model settings and tools into the native loop, applies prepareCall once and prepareStep on every step, and forwards stop conditions and completion callbacks. The cited test file exercises registration, defaults, tool execution, hook overrides, model changes, stop conditions, and callbacks.

Branch uses `@branch/ai` provider streams and its registry-owned harness contract. The source imports `@internal/ai-v6`, `@internal/ai-sdk-v5`, Mastra Agent, and Mastra processor/message contracts; these are absent from Branch's manifests and frozen lockfile. The task forbids lockfile changes and whole upstream tree vendoring. No partial processor or detached helper has been shipped as the requested native integration.

The checkout also lacks the required atlas `INDEX.md`, `data/rows/`, owner `DECISIONS.md`, `DESIGN-SPEC.md`, and page-41 safety guide. The attachment supplies the row description, but not those owner instructions. Status is recorded in `status/pack1-status.csv`; 0/1 cited test files ported and no test command run for this row.
