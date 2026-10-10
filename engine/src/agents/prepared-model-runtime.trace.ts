import { redactSensitiveText } from "../logging/redact.js";
import type { PreparedModelRuntimeOwner } from "./prepared-model-runtime.types.js";

/** Trace text for each owner in a publication scope: published, failed, stale, or pending. */
export function describePreparedModelRuntimeOwnerStates(
  ownerMap: ReadonlyMap<string, PreparedModelRuntimeOwner>,
  agentIds?: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  for (const owner of ownerMap.values()) {
    const agentId = owner.input.agentId;
    if (!agentId || (agentIds && !agentIds.has(agentId))) {
      continue;
    }
    parts.push(`${agentId}=${describePreparedModelRuntimeOwnerState(owner)}`);
  }
  return parts.length > 0 ? parts.join(" ") : "none";
}

/** Failure text for the log: redacted with the tools policy regardless of config, then truncated. */
export function formatPreparedModelFailure(message: string, maxLength: number): string {
  return redactSensitiveText(message, { mode: "tools" }).slice(0, maxLength);
}

function describePreparedModelRuntimeOwnerState(owner: PreparedModelRuntimeOwner): string {
  if (owner.snapshot) {
    return "published";
  }
  if (owner.refreshError) {
    return `failed(${formatPreparedModelFailure(owner.refreshError.message, 120)})`;
  }
  return owner.needsRefresh ? "stale" : "pending";
}
