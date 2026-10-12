# Finalization processors and turn streaming

Plugins can import `TripWire` from `branch/plugin-sdk/agent-harness` and throw it from `before_agent_finalize`.

```ts
throw new TripWire("Include the missing evidence", { retry: true }, "evidence-check");
```

A retry request uses the existing native revision mechanism: the rejected draft is retained as source history and the reason becomes feedback. The pinned processor retry cap is three retries per processor identity and logical run; changing feedback does not reset that budget. The existing native revision limit still applies. Empty feedback stops the run.

Without `retry: true`, TripWire stops the native turn and suppresses the rejected terminal draft. Ordinary hook failures retain their existing behavior. Metadata remains on the original error object; it is not a new persisted event format. Native external harnesses receive their existing stop response.

`getStreamingContext()` reads callbacks and cancellation for the current native run. `runWithStreamingContext()` establishes a nested scope; `runWithSuppressedModelStream()` detaches visible token callbacks while retaining structured event callbacks and cancellation identity. These APIs carry context, not run authority. Existing host admission and tool authorization remain required.

This integration covers finalization processors. Mastra input processors, output stream processors, and its model-output tripwire chunk are separate pending adapters. The source retry resolver preserves explicit caller budgets; this finalization adapter uses the source implicit cap.

The native streaming scope also carries a typed `turnBudget` snapshot when the user writes a token target such as `+500k` or `use 2m tokens`. The parser ignores directives inside code, system reminders, and Qwen-style referenced-file/resource blocks, and reads the transcript prompt before any expanded model prompt. The snapshot is bound to the run and session, with a zero baseline for the native per-run output accumulator. It is a planning target. Workflow fan-out and cross-process ledger sharing remain separate adapters. No implicit target is imposed.
