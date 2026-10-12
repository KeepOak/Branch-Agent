---
summary: "What a model-call span measures, Claude Code CLI turn fidelity, and the full exported metric catalog"
title: "Model calls and exported metrics"
sidebarTitle: "Metrics"
read_when:
  - You need the exact metric names and attribute shapes to build dashboards or alerts
  - You are comparing request-level and turn-level model-call observations
  - You are reading Claude Code CLI byte, timing, or usage numbers
---

## Model-call observation units

Every `branch.model.call` span identifies what its lifecycle measures through
`branch.model_call.observation_unit`:

- `request` - one observable model/provider request. Native embedded model
  calls use this unit, and exporters treat a missing value as `request` for
  compatibility with older or external emitters.
- `turn` - one opaque agent CLI turn that may contain hidden model requests,
  retries, tool work, or background work. Claude Code CLI and Codex app-server
  calls use this unit.

Both units remain model-call spans so trace backends can render model input,
output, usage, and hierarchy. Request spans use the API-derived GenAI operation
(`chat`, `generate_content`, or `text_completion`), while turn spans use
`gen_ai.operation.name = invoke_agent`. Both contribute to
`gen_ai.client.operation.duration`, where the operation name keeps direct
request latency separate from full-turn latency. Branch Agent's OTEL model-call
metrics also include `branch.model_call.observation_unit`; the Prometheus
model-call metrics expose the equivalent `observation_unit` label.

## Claude Code CLI model-call fidelity

Claude Code CLI turns emit one synthetic, turn-level `branch.model.call`
span. These are not Anthropic HTTP request spans. They use `branch.api =
claude-code`, `branch.model_call.observation_unit = turn`, and identify
the operation as `gen_ai.operation.name = invoke_agent`. They identify
Branch Agent's CLI boundary through
`branch.transport`:

- `stdio` - one-shot local Claude Code process.
- `stdio-live` - one turn on a managed persistent Claude stdio session.
- `paired-node-cli` - one-shot Claude Code execution delegated to a paired
  node.

Claude CLI diagnostics are instantiated only while the process diagnostic
dispatcher is enabled and an internal or trusted event listener is attached.
With no observability plugin or other listener active, Claude CLI turns skip
the synthetic trace hierarchy, content buffers, and diagnostic stream-byte
accounting. When content capture is enabled, prompt and system-prompt fields
are capped at 128 KiB each; assistant output is capped at 128 KiB across at
most 200 envelopes, with 16 KiB and one item reserved for a final visible
fallback response. A marker records truncation when the limit is reached.

Branch Agent gives Claude CLI turns the same ownership hierarchy used by other
agent runtimes: `branch.harness.run` (`branch.harness.id = claude-cli`)
contains `branch.run`, which contains the Claude `branch.model.call`
span. The harness and run spans are synthetic Branch Agent turn boundaries, not
Claude Code internal phases. One-shot and managed stdio turns use the same
hierarchy; a real fresh-session retry creates another model-call child inside
the same Branch Agent run.

The span starts when Branch Agent admits the prepared CLI turn and ends only after
that turn succeeds or fails. For managed sessions, an interim success result
does not end the span while Claude reports result-holding background agents or
workflows; the final post-drain result does. Abort, timeout, process failure,
output/parse failure, and other turn failures end the same span with an error.

Claude Code reports per-assistant-message usage and may also report cumulative
usage on its terminal result. Branch Agent reply accounting continues to use the
last assistant message so existing cost semantics do not change; the
turn-level model-call span uses terminal cumulative usage when available,
including cache-read and cache-creation tokens.

For these CLI spans, byte and timing fields describe the observable Branch Agent
CLI boundary:

- `branch.model_call.request_bytes` is the UTF-8 size of the prompt value
  sent over one-shot stdin/argv, or the managed stdio JSONL user envelope. It
  is not the size of Claude Code's hidden model request.
- `branch.model_call.response_bytes` is the UTF-8 size of Claude CLI stdout
  observed during the turn. It is not Anthropic HTTP response size.
- `branch.model_call.time_to_first_byte_ms` is time to the first observable
  Claude CLI stdout or stderr output. It is not network TTFB.

With `captureContent` enabled, the span exports the effective prompt Branch Agent
sends to Claude Code and visible assistant text/tool-call identity
through `gen_ai.input.messages` and `gen_ai.output.messages`. Tool arguments,
internal thinking, opaque thinking signatures, tool results, and system prompts
are omitted from the Claude assistant envelope. Branch Agent does not
claim access to Claude Code's private system prompt, hidden resumed or
compacted request payload, native internal tool schemas, raw Anthropic HTTP
request, internal retries, upstream request id, or true network TTFB. Because
Claude Code does not expose its effective native tool definitions accurately,
these spans do not populate `gen_ai.tool.definitions`.

External Claude harness tool spans remain metadata-only even when tool content
capture is enabled. As with every model span, captured Claude CLI content uses
the trusted listener-only path and the exporter's existing redaction and size
bounds; content remains off by default.

## Exported metrics

### Gateway RPC

Authenticated Gateway WebSocket requests, including dedicated worker RPCs, emit these metrics while diagnostics
and an interested exporter are enabled. They exclude the connection handshake,
malformed request frames, and HTTP routes.

| Metric                                   | Type      | Measurement                                                       |
| ---------------------------------------- | --------- | ----------------------------------------------------------------- |
| `branch.gateway.rpc.requests`          | counter   | Valid requests received, including requests subsequently rejected |
| `branch.gateway.rpc.first_response_ms` | histogram | Receipt through the first successfully sent response              |
| `branch.gateway.rpc.handler_ms`        | histogram | Actual handler invocation through return or throw                 |
| `branch.gateway.rpc.admission_ms`      | histogram | Receipt through actual handler invocation                         |
| `branch.gateway.rpc.queue_wait_ms`     | histogram | Operator start-queue or worker frame-queue wait, when applicable  |
| `branch.gateway.rpc.outcomes`          | counter   | Observations by phase and outcome                                 |

Request and timing metrics have only `branch.gateway.rpc.method`: an exact
core, worker, or registered plugin method name, `other` for unregistered generic
requests, or `unknown` for unrecognized dedicated worker RPCs. Outcome metrics have
only `branch.gateway.rpc.phase` and `branch.gateway.rpc.outcome`, so errors do
not multiply every method's series. No request, connection, session, or trace IDs
appear in metric attributes.

Operator admission includes authorization, lazy router and handler loading, and
start-queue wait. Worker admission includes the socket FIFO wait and outer frame
validation. Worker handler duration includes method validation and service invocation.
Worker timing starts at the JavaScript socket callback, excluding network delay
and event-loop delay before that callback. Queue wait is a subset of admission
for handlers that start, separate from command/session lane `branch.queue.wait_ms`.
Handler and admission samples exist only for invoked handlers. Queue wait is
recorded when dispatch settles.

Worker inference-start timing measures acceptance and setup, not provider completion.
Long worker computer and session operations retain their handler timing after
releasing the socket FIFO. Worker dispatch outcomes describe return or throw.
Connection closure can suppress a response after successful execution and does
not by itself prove execution cancellation.

A sent response means the WebSocket sender accepted the frame, not that the
client received it. Early acknowledgments count as the first response; later
responses do not add another sample. Unavailable or suppressed sends contribute
outcomes but no first-response sample. A handler may return before a retained
callback sends its response, and detached agent work can continue afterward.
These durations measure elapsed time, including asynchronous waits, rather than
CPU time or event-loop blocking time.

Observations use the bounded diagnostic queue. Check
`branch.diagnostic.async_queue.dropped` before treating counts or latency
distributions as complete during saturation.

### Model usage

- `branch.tokens` (counter, attrs: `branch.token`, `branch.channel`, `branch.provider`, `branch.model`, `branch.agent`)
- `branch.cost.usd` (counter, attrs: `branch.channel`, `branch.provider`, `branch.model`)
- `branch.run.duration_ms` (histogram, attrs: `branch.channel`, `branch.provider`, `branch.model`)
- `branch.context.tokens` (histogram, attrs: `branch.context`, `branch.channel`, `branch.provider`, `branch.model`)
- `gen_ai.client.token.usage` (histogram, GenAI semantic-conventions metric, attrs: `gen_ai.token.type` = `input`/`output`, `gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model`)
- `gen_ai.client.operation.duration` (histogram, seconds, GenAI semantic-conventions metric for model requests and synthetic agent turns; attrs: `gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model`, optional `error.type`; turn observations use `gen_ai.operation.name = invoke_agent`)
- `branch.model_call.duration_ms` (histogram, attrs: `branch.provider`, `branch.model`, `branch.api`, `branch.transport`, `branch.model_call.observation_unit`, plus `branch.errorCategory` and `branch.failureKind` on classified errors)
- `branch.model_call.request_bytes` (histogram, UTF-8 byte size of the final model request payload; for Claude Code CLI, the observable prompt input/envelope described above; no raw payload content)
- `branch.model_call.response_bytes` (histogram, UTF-8 byte size of streamed response chunk payloads; high-frequency text, thinking, and tool-call deltas count only incremental `delta` bytes; for Claude Code CLI, observed stdout bytes; no raw response content)
- `branch.model_call.time_to_first_byte_ms` (histogram, elapsed time before the first streamed response event; for Claude Code CLI, first observable CLI output rather than network TTFB)
- `branch.model.failover` (counter, attrs: `branch.provider`, `branch.model`, `branch.failover.to_provider`, `branch.failover.to_model`, `branch.failover.reason`, `branch.failover.suspended`, `branch.lane`)
- `branch.skill.used` (counter, attrs: `branch.skill.name`, `branch.skill.source`, `branch.skill.activation`, optional `branch.agent`, optional `branch.toolName`)

### Message flow

- `branch.webhook.received` (counter, attrs: `branch.channel`, `branch.webhook`)
- `branch.webhook.error` (counter, attrs: `branch.channel`, `branch.webhook`)
- `branch.webhook.duration_ms` (histogram, attrs: `branch.channel`, `branch.webhook`)
- `branch.message.queued` (counter, attrs: `branch.channel`, `branch.source`)
- `branch.message.received` (counter, attrs: `branch.channel`, `branch.source`)
- `branch.message.dispatch.started` (counter, attrs: `branch.channel`, `branch.source`)
- `branch.message.dispatch.completed` (counter, attrs: `branch.channel`, `branch.outcome`, `branch.reason`, `branch.source`)
- `branch.message.dispatch.duration_ms` (histogram, attrs: `branch.channel`, `branch.outcome`, `branch.reason`, `branch.source`)
- `branch.message.processed` (counter, attrs: `branch.channel`, `branch.outcome`)
- `branch.message.duration_ms` (histogram, attrs: `branch.channel`, `branch.outcome`)
- `branch.message.delivery.started` (counter, attrs: `branch.channel`, `branch.delivery.kind`)
- `branch.message.delivery.duration_ms` (histogram, attrs: `branch.channel`, `branch.delivery.kind`, `branch.outcome`, `branch.errorCategory`)

### Talk

- `branch.talk.event` (counter, attrs: `branch.talk.event_type`, `branch.talk.mode`, `branch.talk.transport`, `branch.talk.brain`, `branch.talk.provider`)
- `branch.talk.event.duration_ms` (histogram, attrs: same as `branch.talk.event`; emitted when a Talk event reports duration)
- `branch.talk.audio.bytes` (histogram, attrs: same as `branch.talk.event`; emitted for Talk audio frame events that report byte length)

### Queues and sessions

- `branch.queue.lane.enqueue` (counter, attrs: `branch.lane`)
- `branch.queue.lane.dequeue` (counter, attrs: `branch.lane`)
- `branch.queue.depth` (histogram, attrs: `branch.lane` or `branch.channel=heartbeat`)
- `branch.queue.wait_ms` (histogram, attrs: `branch.lane`)
- `branch.session.state` (counter, attrs: `branch.state`, `branch.reason`)
- `branch.session.stuck` (counter, attrs: `branch.state`; emitted for recoverable stale session bookkeeping)
- `branch.session.stuck_age_ms` (histogram, attrs: `branch.state`; emitted for recoverable stale session bookkeeping)
- `branch.session.turn.created` (counter, attrs: `branch.agent`, `branch.channel`, `branch.trigger`)
- `branch.session.recovery.requested` (counter, attrs: `branch.state`, `branch.action`, `branch.active_work_kind`, `branch.reason`)
- `branch.session.recovery.completed` (counter, attrs: `branch.state`, `branch.action`, `branch.status`, `branch.active_work_kind`, `branch.reason`)
- `branch.session.recovery.age_ms` (histogram, attrs: same as the matching recovery counter)
- `branch.run.attempt` (counter, attrs: `branch.attempt`)

### Session liveness telemetry

A `processing` session does not age toward the built-in liveness threshold while Branch Agent observes reply, tool, status, block, or ACP runtime progress. Typing keepalives do not count as progress, so a silent model or harness can still be detected.

Branch Agent classifies sessions by the work it can still observe:

- `session.long_running`: active embedded work, model calls, or tool calls
  are still making progress. Owned silent model calls also report as long-running before the built-in abort threshold, so slow or non-streaming model providers do not look like stalled gateway sessions while abort-observable.
- `session.stalled`: active work exists, but the active run has not reported
  recent progress. Owned model calls switch from `session.long_running` to
  `session.stalled` at or after the built-in abort threshold; ownerless
  stale model/tool activity is not treated as harmless long-running work.
  Stalled embedded runs stay observe-only at first, then abort-drain after
  the abort threshold with no progress so queued turns behind the lane can resume.
- `session.stuck`: stale session bookkeeping with no active work, or an idle
  queued session with stale ownerless model/tool activity. This releases the
  affected session lane immediately after recovery gates pass.

Recovery emits structured `session.recovery.requested` and
`session.recovery.completed` events. Diagnostic session state is marked idle
only after a mutating recovery outcome (`aborted` or `released`) and only if
the same processing generation is still current.

Only `session.stuck` emits the `branch.session.stuck` counter, the
`branch.session.stuck_age_ms` histogram, and the `branch.session.stuck`
span. Repeated `session.stuck` diagnostics back off while the session remains
unchanged, so dashboards should alert on sustained increases rather than
every heartbeat tick. For the config knob and defaults, see
[Configuration reference](/gateway/config-observability#diagnostics).

Liveness warnings also emit:

- `branch.liveness.warning` (counter, attrs: `branch.liveness.reason`)
- `branch.liveness.event_loop_delay_p99_ms` (histogram, attrs: `branch.liveness.reason`)
- `branch.liveness.event_loop_delay_max_ms` (histogram, attrs: `branch.liveness.reason`)
- `branch.liveness.event_loop_utilization` (histogram, attrs: `branch.liveness.reason`)
- `branch.liveness.cpu_core_ratio` (histogram, attrs: `branch.liveness.reason`)

The CPU ratio measures whole-process CPU usage in core equivalents, including
worker and native threads, and can exceed `1`. Event-loop delay and utilization
measure the main thread separately. See
[CPU pressure and event-loop delay](/gateway/health#cpu-pressure-and-event-loop-delay).

### Gateway event-loop observation windows

- `branch.gateway.event_loop.delay_max_ms` (histogram, no attrs; maximum delay per completed health-monitor window)
- `branch.gateway.event_loop.observed_ms` (counter, no attrs; elapsed milliseconds represented by completed windows)

These metrics use the existing diagnostics plugin setup and require metrics to
be active. Each accepted health-monitor window is recorded once, so a later
healthy readiness result does not erase an earlier high-delay observation.
Health and scrape reads do not commit or reset samples. The process-wide observations carry no request
trace context and create no spans or logs, including with a preloaded SDK.

The monitor samples elapsed event-loop intervals every 20 milliseconds and
completes windows after at least one second or sooner for a delay warning.
Ordinary window resets preserve the pending interval even when health is read
before an overdue sample. Counts and quantiles describe completed windows and
their maxima, not individual stalls or the sampled delay distribution's
overall p99. Intentional monitor resets discard unfinished windows; collection
does not backfill periods without an interested exporter. Diagnostic queue drops,
SDK/export failures, and restarts limit coverage. Use the represented-duration
counter and exporter/drop telemetry to assess it. Readiness decisions and
persistent liveness-warning thresholds are unchanged. For pull metrics and example queries,
see [Prometheus event-loop windows](/gateway/prometheus#event-loop-observation-windows).

### Harness lifecycle

- `branch.harness.duration_ms` (histogram, attrs: `branch.harness.id`, `branch.harness.plugin`, `branch.outcome`, `branch.harness.phase` on errors)

### Tool execution and loop detection

- `branch.tool.execution.duration_ms` (histogram, attrs: `gen_ai.tool.name`, `branch.toolName`, `branch.tool.source`, `branch.tool.owner`, `branch.tool.params.kind`, plus `branch.errorCategory` on errors)
- `branch.tool.execution.blocked` (counter, attrs: `gen_ai.tool.name`, `branch.toolName`, `branch.tool.source`, `branch.tool.owner`, `branch.tool.params.kind`, `branch.deniedReason`)
- `branch.tool.loop` (counter, attrs: `branch.toolName`, `branch.loop.level`, `branch.loop.action`, `branch.loop.detector`, `branch.loop.count`, optional `branch.loop.paired_tool`; emitted when a repetitive tool-call loop is detected)

### Exec

- `branch.exec.duration_ms` (histogram, attrs: `branch.exec.target`, `branch.exec.mode`, `branch.outcome`, `branch.failureKind`)

### Diagnostics internals (memory, payloads, exporter health)

- `branch.gc.duration_ms` (histogram, no attrs; elapsed GC duration for the hosting JavaScript isolate)

GC duration uses Node.js performance entries and is exported only when metrics
are enabled. It is not CPU time or a guaranteed stop-the-world pause. Observation
starts when the existing diagnostics heartbeat sees an interested consumer;
registration after startup can wait until its next 30-second tick, with no
backfill. Diagnostics disable/shutdown disconnects immediately. See
[GC duration coverage and correlation limits](/gateway/prometheus#garbage-collection-duration).

- `branch.payload.large` (counter, attrs: `branch.payload.surface`, `branch.payload.action`, `branch.channel`, `branch.plugin`, `branch.reason`)
- `branch.payload.large_bytes` (histogram, attrs: same as `branch.payload.large`)
- `branch.memory.rss_bytes` / `branch.memory.heap_used_bytes` / `branch.memory.heap_total_bytes` / `branch.memory.external_bytes` / `branch.memory.array_buffers_bytes` (histograms, no attrs; process memory samples)
- `branch.memory.pressure` (counter, attrs: `branch.memory.level`, `branch.memory.reason`)
- `branch.diagnostic.async_queue.dropped` (counter, attrs: `branch.diagnostic.async_queue.drop_class`; internal diagnostic-queue backpressure drops)
- `branch.telemetry.exporter.events` (counter, attrs: `branch.exporter`, `branch.signal`, `branch.status`, optional `branch.reason`, optional `branch.errorCategory`; exporter lifecycle/failure self-telemetry)
