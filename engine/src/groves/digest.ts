import { sha256StableValue } from "@branch/normalization-core/node-crypto";

export function digestGroveValue(value: unknown): string {
  return `sha256:${sha256StableValue(value).digest}`;
}
