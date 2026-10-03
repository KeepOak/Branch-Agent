import { isRecord } from "@branch/normalization-core/record-coerce";
import type { BranchConfig } from "./types.branch.js";

/** Returns a channel config object when `channels.<id>` is present and object-shaped. */
export function resolveChannelConfigRecord(
  cfg: BranchConfig,
  channelId: string,
): Record<string, unknown> | null {
  const entry = cfg.channels?.[channelId];
  return isRecord(entry) ? entry : null;
}

/** Checks whether a shallow channel config contains activation-relevant values. */
export function hasMeaningfulChannelConfigShallow(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "enabled") {
    // `enabled: false` alone is an explicit non-configuration signal, but true opts in.
    return value.enabled === true;
  }
  return keys.some((key) => key !== "enabled");
}

/** Channel configuration can admit bundled plugin capabilities through an allowlist. */
export function resolveChannelConfigActivationFacts(config: BranchConfig): string[] {
  return Object.keys(config.channels ?? {})
    .filter((channelId) => {
      const channel = resolveChannelConfigRecord(config, channelId);
      return channel?.enabled !== false && hasMeaningfulChannelConfigShallow(channel);
    })
    .toSorted();
}
