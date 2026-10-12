import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import type { MemoryOriginClass } from "./types.js";

export function classifySessionMessageOrigin(
  message: {
    role?: unknown;
    provenance?: unknown;
  } & Record<string, unknown>,
  turnOrigin: MemoryOriginClass,
): MemoryOriginClass {
  if (message.role === "assistant") {
    const branchMetadata = asOptionalRecord(message["__branch"]);
    if (branchMetadata?.turnTainted === true) {
      return "untrusted";
    }
    return turnOrigin === "owner" ? "agent" : turnOrigin;
  }
  const provenance = asOptionalRecord(message.provenance);
  if (provenance?.kind === "internal_system") {
    return "system";
  }
  const metadata = asOptionalRecord(message["__branch"]);
  return metadata?.senderIsOwner === true ? "owner" : "untrusted";
}
