import { isDeepStrictEqual } from "node:util";
import { serializeConfigResolutionFacts } from "./resolution-facts.js";
import type { ConfigFileSnapshot } from "./types.js";

/** Compare authored revisions and env-resolved inputs, never runtime defaults. */
export function describeConfigSnapshotInputChange(
  before: ConfigFileSnapshot,
  after: ConfigFileSnapshot,
  options: { allowPathChange?: boolean; compareResolvedConfig?: boolean } = {},
): string | undefined {
  if (!options.allowPathChange && before.path !== after.path) {
    return "config file path changed";
  }
  if (before.exists !== after.exists) {
    return "config file was created or removed";
  }
  if ((before.hash ?? before.raw) !== (after.hash ?? after.raw)) {
    return before.raw !== after.raw
      ? "authored config file contents changed"
      : "included config contents or targets changed";
  }
  // The revision excludes env substitutions, which can change migration destinations.
  if (options.compareResolvedConfig !== false) {
    if (!isDeepStrictEqual(before.sourceConfig, after.sourceConfig)) {
      return "resolved config values changed";
    }
    // Same-text values can change from pending references to resolved literals.
    if (
      !isDeepStrictEqual(
        serializeConfigResolutionFacts(before.sourceConfig),
        serializeConfigResolutionFacts(after.sourceConfig),
      )
    ) {
      return "resolved config provenance changed";
    }
  }
  return undefined;
}

function withoutLockdown(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  const security = root.security;
  if (!security || typeof security !== "object" || Array.isArray(security) || !("lockdown" in security)) {
    return value;
  }
  const { lockdown: _lockdown, ...rest } = security as Record<string, unknown>;
  const next: Record<string, unknown> = { ...root, security: rest };
  if (Object.keys(rest).length === 0) delete next.security;
  return next;
}

/**
 * True when the only difference between two reads of the same config is the Lockdown switch. An engine
 * preparing during a handoff can still start: it reads Lockdown fresh when it starts, so it comes up locked.
 */
export function isLockdownOnlyConfigChange(before: ConfigFileSnapshot, after: ConfigFileSnapshot): boolean {
  return (
    before.path === after.path &&
    before.exists &&
    after.exists &&
    before.valid === after.valid &&
    isDeepStrictEqual(before.includedPaths ?? [], after.includedPaths ?? []) &&
    isDeepStrictEqual(withoutLockdown(before.parsed), withoutLockdown(after.parsed)) &&
    isDeepStrictEqual(withoutLockdown(before.sourceConfig), withoutLockdown(after.sourceConfig))
  );
}
