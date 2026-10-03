import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import { normalizeNullableString } from "@branch/normalization-core/string-coerce";

export function readMessageIdempotencyKey(message: unknown): string | null {
  return normalizeNullableString(asOptionalRecord(message)?.idempotencyKey);
}
