// Wire shape mirrors the SDK schema (StepFinishPart.metrics). `source` stays on the wire for backward
// compatibility with downstream consumers —
// but only the "computed" literal is reachable here because llama.cpp's
// `prompt_per_second` / `predicted_per_second` are dropped upstream by
// `@ai-sdk/openai-compatible` before the raw usage reaches our adapter.
// Follow-up: wire `metadataExtractor` into the shared
// `createOpenAICompatible` call so the provider source is reachable again.
export type TokenRates = {
  prompt?: number
  generation?: number
  source: "computed"
}

export type ComputeInput = {
  providerMetadata?: unknown
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
  elapsedMs: number
}

// tokens/second throughput.
export function computeMetrics(input: ComputeInput): TokenRates | undefined {
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return undefined

  const generated = input.tokens.output + input.tokens.reasoning
  if (generated <= 0) return undefined

  const generation = (generated * 1000) / input.elapsedMs
  if (!Number.isFinite(generation) || generation <= 0) return undefined

  return { generation, source: "computed" }
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 t/s"
  return `${numberFormat.format(value)} t/s`
}

/** Projects only explicitly measured assistant-call duration and normalized usage.
 * Branch output includes reasoning as a detail (agents/usage.ts), whereas the
 * source takes separate visible output and reasoning buckets. Pass that inclusive
 * output once; do not add the reasoning detail a second time or infer duration
 * from adjacent message timestamps.
 */
export function projectMessageTokenMetrics(entry: {
  role?: string;
  durationMs?: number;
  usage?: { output?: number; reasoningTokens?: number };
}): { durationMs?: number; metrics?: TokenRates } {
  if (entry.role !== "assistant" || entry.durationMs === undefined ||
      !Number.isFinite(entry.durationMs) || entry.durationMs <= 0) return {};
  const output = entry.usage?.output;
  const metrics = output === undefined ? undefined : computeMetrics({
    elapsedMs: entry.durationMs,
    tokens: { input: 0, output, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  return { durationMs: entry.durationMs, ...(metrics ? { metrics } : {}) };
}
