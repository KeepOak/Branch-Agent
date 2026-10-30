export const FREE_MODEL_SKIPPED = "Free model setup was skipped.";

// The engine puts a plain reason in the first paragraph of a skip note and technical
// details after it. Older notes are technical only, so they keep the bare sentence.
const TECHNICAL = /runtime|\bCUDA\b|\bCPU\b|embedding|llama\.cpp|GGUF|budget|director(?:y|ies)|volume|\b(?:metal|vulkan|backend|gateway|host|server)\b|skipped/i;

export function plainFreeModelSkip(step: { message?: string }): string {
  const paragraphs = (step.message ?? "").trim().split(/\r?\n\s*\r?\n/);
  const why = paragraphs.length > 1 ? paragraphs[0]!.trim() : "";
  return why && !TECHNICAL.test(why) ? `${FREE_MODEL_SKIPPED} ${why}` : FREE_MODEL_SKIPPED;
}

/** The engine reports a skip as notes before its generic failure; say why when a note can. */
export function skippedFreeModelReason(notes: readonly string[]): string | undefined {
  for (const message of notes) {
    const plain = plainFreeModelSkip({ message });
    if (plain !== FREE_MODEL_SKIPPED) return plain;
  }
  return undefined;
}
