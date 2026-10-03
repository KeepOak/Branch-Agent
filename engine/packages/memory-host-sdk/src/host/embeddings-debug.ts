import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";

const debugEmbeddings = ["true", "1", "on", "yes"].includes(
  normalizeLowercaseStringOrEmpty(process.env.BRANCH_DEBUG_MEMORY_EMBEDDINGS),
);

/** Write embedding debug metadata when BRANCH_DEBUG_MEMORY_EMBEDDINGS is enabled. */
export function debugEmbeddingsLog(message: string, meta?: Record<string, unknown>): void {
  if (!debugEmbeddings) {
    return;
  }
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.warn(`${message}${suffix}`);
}
