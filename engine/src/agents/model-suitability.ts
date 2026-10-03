export type ModelSuitabilitySelection = { provider: string; model: string; name?: string };
type ModelSuitabilityCatalogEntry = { provider: string; id: string; name: string };

const RECOMMENDED_MODEL_PATTERNS = [
  /gemini/,
  /claude/,
  /gpt/,
  /o\d/,
  /kimi/,
  /qwen/,
  /llama/,
  /nemotron/,
  /grok/,
  /mistral/,
];

/** Family-name heuristic from Continue; this does not measure model capabilities. */
export function isModelRecommendedForAgenticUse(name: string, model?: string): boolean {
  const candidates = [name.toLowerCase(), model?.toLowerCase() ?? ""];
  return candidates.some((candidate) =>
    RECOMMENDED_MODEL_PATTERNS.some((pattern) => pattern.test(candidate)),
  );
}

/** Returns advisory text only; callers retain their existing selection policy. */
export function formatModelSuitabilityWarning(
  selection: ModelSuitabilitySelection,
  catalog: readonly ModelSuitabilityCatalogEntry[] = [],
): string | undefined {
  const name =
    selection.name ??
    catalog.find((entry) => entry.provider === selection.provider && entry.id === selection.model)
      ?.name ??
    selection.model;
  if (isModelRecommendedForAgenticUse(name, selection.model)) {
    return undefined;
  }
  return `Warning: Model "${name}" is not among the model families recommended for agentic use. Reasoning and tool calling capabilities may be limited; selection remains available.`;
}
