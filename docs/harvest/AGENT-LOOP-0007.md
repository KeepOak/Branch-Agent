# AGENT-LOOP-0007 — TripWire abort/retry feedback

Pinned source: mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421,
verified in `/tmp/upstream/mastra-ai-mastra`.

Branch already contains the source TripWire class and a production adapter in
plugins/hooks.ts and agents/harness/lifecycle-hook-helpers.ts. The new named
behaviour suite exercises that real dispatcher/harness path: hard abort retains
the typed error and metadata, later handlers do not execute after abort, retry
feedback causes revision, and ordinary errors retain native best-effort handling.
All four tests passed. The existing attempt-stream-finalize suite also passed
all fourteen cases, including rewinding the rejected assistant branch while
keeping persistence append-only.

This is partial native integration evidence, not a complete upstream-suite port.
The recorded agent-processor.test.ts also requires input/step/stream/result
processor phases, TripWire stream chunks with metadata/processorId, retryCount,
structured output after retry, prompt-prefix preservation and workflow processors.
Those contracts depend on the unported processor/workflow runtime (0004–0006).
The full recorded suite remains unported (0/1); required design/decision and
pack documents are absent. State: blocked. No upstream tests were deleted,
skipped or weakened and no complete coverage is claimed.
