// Mirror the runtime wire delimiters so producer drift still fails through QA.
const INTERNAL_RUNTIME_CONTEXT_BEGIN = "<<<BEGIN_BRANCH_INTERNAL_CONTEXT>>>";
const INTERNAL_RUNTIME_CONTEXT_END = "<<<END_BRANCH_INTERNAL_CONTEXT>>>";

export function isInternalRuntimeContextCarrierText(text: string) {
  const trimmed = text.trim();
  return (
    trimmed.includes(INTERNAL_RUNTIME_CONTEXT_BEGIN) &&
    trimmed.endsWith(INTERNAL_RUNTIME_CONTEXT_END)
  );
}
