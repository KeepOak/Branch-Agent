# AGENT-LOOP-0004: skipped (needs Mastra's workflow engine, which Branch does not have)

Source: `mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421`, `packages/core/src/loop/`.

`loop.ts` runs the model and tool iteration as a Mastra workflow (`workflowLoopStream` in `loop/workflows/stream.ts`). It imports Mastra's own error, observability, logger, processor, stream and model-settings modules, plus `@internal/ai-sdk-v5`. Porting it means porting most of Mastra's workflow runtime (suspend, resume, evented steps, pubsub and workers), which is a framework and not one row. GitHub reports no SPDX license for the repository (`NOASSERTION`), so the license needs checking too.

Branch's loop keeps its own suspend and resume through `engine/src/agents/embedded-agent-runner/run/` and the main-session recovery store. Routing the loop through a workflow engine is a product decision.

Unblock: a dedicated card to choose a workflow engine for Branch, then port the loop steps and their three test files.
