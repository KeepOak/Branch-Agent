# AGENT-LOOP-0026 — blocked

Source: `mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421`.
The filtered clone at `/tmp/upstream/mastra-ai-mastra` is checked out at the pin.

The model manager runs SDK models through the evented agent loop; its generate-to-stream adapter preserves tool metadata, provider-executed tool results, text/reasoning/file/source content, custom parts, raw unknown parts, finish reasons, and usage. The six adapter unit tests prove metadata and lossless content conversion. The model-loop E2E file proves text generation/streaming and structured object output with Mastra workers and the recorded gateway.

`model.loop.ts` imports SDK v5, Mastra's loop, message list, observability, errors, and stream output. The E2E file additionally imports `@ai-sdk/openai-v5`, `@internal/llm-recorder`, and `@internal/test-utils`. None is registered in Branch's frozen dependency graph. Copying only the dependency-free generate adapter would leave it without a production caller and would not implement the row. No such orphan helper was added.

The task prohibits lockfile changes and vendoring whole upstream trees. The atlas and owner safety/design inputs requested for every row are absent (see AGENT-LOOP-0025). 0/2 cited test files ported; no test command run.
