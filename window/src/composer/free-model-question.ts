import type { WizardStep } from "../places/settings/account-login";

const PLAIN_QUESTION = "Download a free model so Branch can answer without an account?";
const BYTES_PER_GB = 1_000_000_000;

function gb(bytes: number | undefined): string | undefined {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 ? (bytes / BYTES_PER_GB).toFixed(1) + " GB" : undefined;
}

/** Words the engine's free model question from its structured fields, never from its English message. */
export function plainFreeModelQuestion(step: Partial<Pick<WizardStep, "freeModel" | "message">>): string {
  const facts = step.freeModel;
  const size = gb(facts?.downloadBytes);
  if (facts?.kind === "search-model-only") {
    return "Download only the small model that lets Branch search memories by meaning" + (size ? " (" + size + ")" : "") + "? Your chat model stays the same.";
  }
  const name = facts?.modelName?.trim();
  if (!name) return PLAIN_QUESTION;
  if (facts?.kind === "cached-model") {
    // The model is here, but the search model or runtime files may still need downloading: say how much.
    return "Use the free model " + name + " that is already on this computer" + (size ? " (" + size + " still to download)" : "") + " so Branch can answer without an account?";
  }
  if (facts?.kind === "model") return "Download a free model (" + name + (size ? ", " + size : "") + ") so Branch can answer without an account?";
  return PLAIN_QUESTION;
}
