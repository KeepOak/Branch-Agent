import { sha256Hex, sha256StableValue } from "@branch/normalization-core/node-crypto";

export function digestGroveValue(value: unknown): string {
  return `sha256:${sha256StableValue(value).digest}`;
}

export function digestGroveBytes(value: Uint8Array): string {
  return `sha256:${sha256Hex(value)}`;
}
