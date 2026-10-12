/** Adapted source validation from Gemini CLI edit.ts:1225 and write-file.ts:709,
 * pinned google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad. */
import { detectOmissionPlaceholders } from "./omission-placeholder-detector.js";

export function assertCompleteFileWriteContent(content: string): void {
  if (detectOmissionPlaceholders(content).length > 0) {
    throw new Error(
      "`content` contains an omission placeholder (for example 'rest of methods ...'). Provide complete file content.",
    );
  }
}

export function assertLiteralFileEdits(
  edits: readonly { oldText: string; newText: string }[],
): void {
  for (const edit of edits) {
    const newPlaceholders = detectOmissionPlaceholders(edit.newText);
    if (newPlaceholders.length === 0) continue;
    const oldPlaceholders = new Set(detectOmissionPlaceholders(edit.oldText));
    for (const placeholder of newPlaceholders) {
      if (!oldPlaceholders.has(placeholder)) {
        throw new Error(
          "Replacement text contains an omission placeholder (for example 'rest of methods ...'). Provide exact literal replacement text.",
        );
      }
    }
  }
}
