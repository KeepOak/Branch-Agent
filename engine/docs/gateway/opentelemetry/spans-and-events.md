---
summary: "The exported span catalog with its attributes, and the diagnostic event catalog behind the metrics and spans"
title: "Exported spans and diagnostic events"
sidebarTitle: "Spans and events"
read_when:
  - You need the exact span names or attribute shapes to build dashboards or alerts
  - You are subscribing a plugin to public diagnostic events
  - You need session-correlated usage that the exported metrics intentionally omit
---

## Exported spans

- `branch.gateway.rpc.response`, `branch.gateway.rpc.handler`, `branch.gateway.rpc.dispatch`
  - Completed phase observations with `branch.gateway.rpc.method`, `branch.gateway.rpc.phase`, and `branch.gateway.rpc.outcome`
  - Handler spans include `branch.gateway.rpc.admission_ms`; dispatch spans include `branch.gateway.rpc.response`, the response state at dispatch settlement
  - Preserve a supplied upstream request parent; they do not introduce a long-lived RPC parent span or change downstream trace propagation

- `branch.model.usage`
  - `branch.channel`, `branch.provider`, `branch.model`, optional `branch.agent` (the agent that owns the run when known)
  - Optional host-derived `branch.plugin` only for trusted plugin runtime completions
  - `branch.tokens.*` (input/output/cache_read/cache_write/total)
  - `gen_ai.system` by default, or `gen_ai.provider.name` when the latest GenAI semantic conventions are opted in
  - `gen_ai.request.model`, `gen_ai.operation.name`, `gen_ai.usage.*`

Plugin attribution is span-only. It does not add a plugin dimension to shared
OpenTelemetry metrics or change Prometheus metric labels.

- `branch.run`
  - `branch.outcome`, `branch.channel`, `branch.provider`, `branch.model`, `branch.errorCategory`, optional `branch.agent`
- `branch.model.call`
  - `gen_ai.system` by default, or `gen_ai.provider.name` when the latest GenAI semantic conventions are opted in
  - `gen_ai.request.model`, `gen_ai.operation.name`, `branch.provider`, `branch.model`, `branch.api`, `branch.transport`, `branch.model_call.observation_unit` (`request` or `turn`), optional `branch.agent`
  - `branch.errorCategory`, `error.type`, and optional `branch.failureKind` on errors
  - `branch.model_call.request_bytes`, `branch.model_call.response_bytes`, `branch.model_call.time_to_first_byte_ms`
  - `branch.model_call.prompt.input_messages_count`, `branch.model_call.prompt.input_messages_chars`, `branch.model_call.prompt.system_prompt_chars`, `branch.model_call.prompt.tool_definitions_count`, `branch.model_call.prompt.tool_definitions_chars`, `branch.model_call.prompt.total_chars` (safe component sizes only, no prompt text)
  - `branch.model_call.usage.*` and `gen_ai.usage.*` when the result carries usage for that request or aggregate turn
  - Span event `branch.provider.request` with attribute `branch.upstreamRequestIdHash` (bounded, hash-based) when the upstream provider result exposes a request id; raw ids are never exported
  - With `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`, request spans use the latest GenAI inference span name `{gen_ai.operation.name} {gen_ai.request.model}`. Turn spans use `invoke_agent` because Branch Agent does not claim a native agent name from the opaque CLI boundary. Both use `CLIENT` span kind instead of `branch.model.call`.
- `branch.harness.run`
  - `branch.harness.id`, `branch.harness.plugin`, `branch.outcome`, `branch.provider`, `branch.model`, `branch.channel`, optional `branch.agent`
  - On completion: `branch.harness.result_classification`, `branch.harness.yield_detected`, `branch.harness.items.started`, `branch.harness.items.completed`, `branch.harness.items.active`
  - On error: `branch.harness.phase`, `branch.errorCategory`, optional `branch.harness.cleanup_failed`
  - Span event `branch.agent.commentary` for completed preambles from supported harnesses, including the built-in runtime, Codex, and Claude CLI. Attributes include `branch.commentary.sequence`, `branch.commentary.text_length`, and `branch.commentary.content_truncated`. The existing `diagnostics.otel.captureContent` setting controls bounded, redacted output-message content.
- `branch.tool.execution`
  - `gen_ai.tool.name`, `gen_ai.operation.name` (`execute_tool`), `branch.toolName`, `branch.tool.source`, optional `gen_ai.tool.call.id`, `branch.tool.owner`, `branch.tool.params.*`, optional `branch.agent`
  - Optional `branch.errorCategory`/`branch.errorCode` on errors, `branch.deniedReason` and `branch.outcome=blocked` when denied by policy or sandbox
- `branch.exec`
  - `branch.exec.target`, `branch.exec.mode`, `branch.outcome`, `branch.failureKind`, `branch.exec.command_length`, `branch.exec.exit_code`, `branch.exec.exit_signal`, `branch.exec.timed_out`
- `branch.webhook.processed`
  - `branch.channel`, `branch.webhook`
- `branch.webhook.error`
  - `branch.channel`, `branch.webhook`, `branch.error`
- `branch.message.processed`
  - `branch.channel`, `branch.outcome`, `branch.reason`, optional `branch.agent` (the agent that initially ingested the prompt)
  - Isolated cron agent turns use this span as the parent of their harness spans, keeping model calls, tools, and usage on the same trace through completion or failure.
- `branch.message.delivery`
  - `branch.channel`, `branch.delivery.kind`, `branch.outcome`, `branch.errorCategory`, `branch.delivery.result_count`
- `branch.session.stuck`
  - `branch.state`, `branch.ageMs`, `branch.queueDepth`
- `branch.context.assembled`
  - `branch.prompt.size`, `branch.history.size`, `branch.context.tokens`, `branch.errorCategory` (no prompt, history, response, or session-key content)
- `branch.tool.loop`
  - `branch.toolName`, `branch.loop.level`, `branch.loop.action`, `branch.loop.detector`, `branch.loop.count`, optional `branch.loop.paired_tool`, optional `branch.agent` (no loop messages, params, or tool output)
- `branch.memory.pressure`
  - `branch.memory.level`, `branch.memory.reason`, `branch.memory.rss_bytes`, `branch.memory.heap_used_bytes`, `branch.memory.heap_total_bytes`, `branch.memory.external_bytes`, `branch.memory.array_buffers_bytes`, optional `branch.memory.threshold_bytes`/`branch.memory.rss_growth_bytes`/`branch.memory.window_ms`

When content capture is explicitly enabled, model and tool spans can also
include bounded, redacted `branch.content.*` attributes for the specific
content classes you opted into.

## Diagnostic event catalog

The events below back the
[metrics](/gateway/opentelemetry/model-calls-and-metrics#exported-metrics) and
spans above. Public events are also
available for direct plugin subscription; trusted core events such as
`model.usage` are restricted to authorized internal consumers.
`run.progress` and `run.execution_phase` are direct-only lifecycle signals;
the diagnostics-otel plugin does not export them as standalone OTLP signals.
Event kinds and `run.execution_phase.phase` values are additive. TypeScript
consumers should keep default branches instead of assuming either union is
permanently exhaustive.

`agent.commentary` records completed preambles, not text deltas. It carries the
original agent-event sequence and timestamp and attaches to the active harness
span. Recent duplicate completions are suppressed per attempt. Like other
queued diagnostics, commentary may be dropped under queue pressure; the session
transcript remains the durable conversation record. At debug level, the
`diagnostic` logger also records completion metadata without commentary text.

**Model usage**

`model.usage` is a trusted, in-process diagnostic event, not a JSONL log
record. A representative event has this shape:

```json
{
  "type": "model.usage",
  "ts": 1735689600000,
  "seq": 42,
  "provider": "openai",
  "model": "gpt-5.4",
  "channel": "webchat",
  "agentId": "main",
  "sessionId": "session-123",
  "sessionKey": "agent:main:main",
  "usage": {
    "input": 120,
    "output": 40,
    "cacheRead": 30,
    "cacheWrite": 10,
    "promptTokens": 160,
    "total": 200
  },
  "lastCallUsage": {
    "input": 120,
    "output": 40,
    "cacheRead": 30,
    "cacheWrite": 10,
    "total": 200
  },
  "context": { "limit": 128000, "used": 160 },
  "costUsd": 0.0012,
  "durationMs": 850,
  "trace": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7",
    "traceFlags": "01"
  }
}
```

- `ts` is a Unix timestamp in milliseconds; `seq` is process-local.
- `usage` holds turn-level token counts. `promptTokens` includes `input`,
  `cacheRead`, and `cacheWrite`; `lastCallUsage`, when available, describes the
  final model call.
- `context.used` is the current prompt/context snapshot and can be lower than
  `usage.total` when cached input or tool-loop calls are involved.
- Provider/model/session identifiers, token buckets, `lastCallUsage`,
  `context`, `costUsd`, `durationMs`, and `trace` fields are optional.
  `costUsd` is an estimate and can be absent when model pricing is unavailable;
  it is not provider-reported billing. Trace context can also include
  `parentSpanId`.

The Gateway's `/tmp/branch/branch-YYYY-MM-DD.log` JSONL file and
`diagnostics.otel.logsExporter: "stdout"` contain ordinary log records, not raw
`model.usage` events. Public diagnostic subscriptions and
`diagnostics.stability` do not expose trusted core usage events. The
diagnostics-otel plugin converts them to metrics such as `branch.tokens` and
`branch.cost.usd` and to `branch.model.usage` spans; those usage metrics
and spans intentionally omit session identifiers.

For an external integration that needs session-correlated usage, query the
authenticated Gateway instead:

```bash
branch gateway call sessions.usage --params '{"range":"30d","agentScope":"all"}' --json
branch gateway usage-cost --days 30 --all-agents --json
```

Both commands require `operator.read`. `sessions.usage` can include per-session
`sessionId`, provider/model details, and token/cost summaries; per-session usage
can be temporarily `null` while its cache refreshes. `usage-cost` provides
aggregate estimates. Omit `agentScope` or `--all-agents` to scope the report
to the default agent. For continuously updated clients,
[subscribe to session changes instead of polling usage reports](/gateway/clients#subscribe-instead-of-polling-usage).
See the [Gateway RPC method reference](/gateway/protocol/rpc-methods#rpc-method-families)
for usage methods and request options.

**Message flow**

- `webhook.received` / `webhook.processed` / `webhook.error`
- `message.queued` / `message.processed`
- `message.delivery.started` / `message.delivery.completed` / `message.delivery.error`

**Gateway RPC**

- `gateway.rpc` - trusted request observations with phases `received`, `response`,
  `handler`, and `dispatch`. Response outcomes are `ok`, `error`, `unavailable`,
  or `suppressed`; handler outcomes are `returned` or `threw`; dispatch outcomes
  are `returned`, `threw`, `rejected`, or `cancelled`. Dispatch records its response
  state (`none`, `sent`, `unavailable`, or `suppressed`) at settlement; a later
  response can still arrive. Durations and queue/admission semantics are described
  in [Gateway RPC metrics](/gateway/opentelemetry#gateway-rpc).

**Queue and session**

- `queue.lane.enqueue` / `queue.lane.dequeue`
- `session.state` / `session.long_running` / `session.stalled` / `session.stuck`
- `run.attempt` / `run.progress`
- `run.execution_phase` (public, session-correlated embedded-runner startup milestones)
- `diagnostic.heartbeat` (aggregate counters: webhooks/queue/session)
- `gateway.event_loop.sample` (internal metrics-only completed window: `intervalMs`, `delayMaxMs`; no reader identity)

**Harness lifecycle**

- `harness.run.started` / `harness.run.completed` / `harness.run.error` -
  per-run lifecycle for the agent harness. Includes `harnessId`, optional
  `pluginId`, provider/model/channel, and run id. Completion adds
  `durationMs`, `outcome`, optional `resultClassification`, `yieldDetected`,
  and `itemLifecycle` counts. Errors add `phase`
  (`prepare`/`start`/`send`/`resolve`/`cleanup`), `errorCategory`, and
  optional `cleanupFailed`.

**Exec**

- `exec.process.completed` - terminal outcome, duration, target, mode, exit
  code, and failure kind. Command text and working directories are not
  included.
- `exec.approval.followup_suppressed` - stale approval follow-up dropped
  after a session rebound. Includes `approvalId`, `reason`
  (`session_rebound`), `phase` (`direct_delivery` or `gateway_preflight`),
  and the dispatcher timestamp. Session keys, routes, and command text are
  not included.
