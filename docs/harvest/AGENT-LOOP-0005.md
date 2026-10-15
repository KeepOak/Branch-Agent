# AGENT-LOOP-0005 — processor pipeline

Pinned source: mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421,
verified in `/tmp/upstream/mastra-ai-mastra`.

ProcessorRunner dispatches input, input-step, LLM-request, tool-result,
output-stream, output-step, output-result and API-error phases. It owns ordered
transforms, per-processor state, stream history, TripWire violation callbacks,
workflow adaptation and model/message conversions.

Branch's plugin lifecycle hooks and existing TripWire adapter cover part of this
surface, but they do not implement the Mastra Processor/ProcessorStepSchema
contracts or its message-list/stream-output adapters. The source runner imports
the unported Mastra MessageList, state signals, observability and workflows;
the required internal AI SDK v5 and provider v5 imports are unresolved in Branch.
A complete runner, native loop wiring and behaviour suite have not been ported.
The atlas records no upstream test files (0/0), which does not mean this row is
verified. Required design/decision and pack dependency documents are absent.
State: blocked; existing hooks are not claimed as complete processor coverage.
