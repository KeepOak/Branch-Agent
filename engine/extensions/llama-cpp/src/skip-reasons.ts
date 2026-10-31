// Plain reasons for a skipped free model setup. This file has no imports so the window
// can read the same words it shows; keep them free of file, computer and backend names.
export const LLAMA_CPP_SKIP_REASONS = {
  diskUnknown: "Branch couldn’t check how much free space this computer has.",
  diskFull: "This computer doesn’t have enough free disk space for a free model.",
  memory: "This computer doesn’t have enough memory to run a free model.",
} as const;

export type LlamaCppSkipReason =
  (typeof LLAMA_CPP_SKIP_REASONS)[keyof typeof LLAMA_CPP_SKIP_REASONS];

/** Plain reason first, then the technical details for the command line. */
export function formatLlamaCppSkipNote(plainReason: string, details: string): string {
  return `${plainReason}\n\n${details}`;
}
