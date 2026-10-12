# @branch/diagnostics-otel

Official OpenTelemetry diagnostics exporter for Branch Agent.

This plugin exports Branch Agent Gateway traces, metrics, and logs to an OTLP collector for observability stacks such as Grafana, Datadog, Honeycomb, New Relic, Tempo, and compatible collectors. It can also write diagnostic log records as stdout JSONL for container log pipelines.

## Install

```bash
branch plugins install @branch/diagnostics-otel
```

Restart the Gateway after installing or updating the plugin.

## Configure

Enable the plugin, set `diagnostics.otel.enabled` to `true`, and set the collector URL in `diagnostics.otel.endpoint`.

The full config surface, metric names, span names, and collector examples live in the docs:

- https://docs.openclaw.ai/gateway/opentelemetry

## Package

- Plugin id: `diagnostics-otel`
- Package: `@branch/diagnostics-otel`
- Minimum Branch Agent host: `2026.4.25`
