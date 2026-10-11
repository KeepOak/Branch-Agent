# AGENT-LOOP-0080: skipped (the watchdog needs contracts Branch's providers do not offer)

Source: `letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba`, `src/cli/helpers/stream-stall-reconciler.ts`, `src/cli/helpers/stream-terminal-eof-guard.ts`.

Two guards, two different blockers.

1. The stall reconciler waits 60 seconds of silence, then asks the server for the run's status (`retrieveRunStatus`) and aborts the read only if the run is not active. It assumes the server sends a keepalive ping about every 20 seconds (`include_pings`) and that a run status endpoint exists. Branch's model providers give neither. A reasoning model can stay silent for longer than 60 seconds, so copying the default would abort legitimate runs. Branch would need a per-provider silence floor, which is a product decision.
2. The terminal-EOF guard aborts the read 2 seconds after a stop reason if the body does not end. Branch reads provider streams in at least eight places: `engine/packages/ai/src/transports/transport-utils.ts`, `transports/anthropic-transport-stream.ts`, `transports/openai-responses-compaction-window.ts`, `providers/mistral.ts`, `providers/openai-chatgpt-responses.ts`, `providers/openai-chatgpt-responses-protocol.ts`, `providers/google-interactions-shared.ts` and `aisdk/runtime.ts`. Each has its own stop event, so there is no single boundary to hang the guard on.

Unblock: pick the providers to guard first, give each its stop event and a silence floor, then port the guard with its two test files.
