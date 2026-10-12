import { asNullableRecord as asConfigRecord } from "@branch/normalization-core/record-coerce";

export function ringsConfigPath(pluginId: string, path: readonly string[]) {
  return ["plugins", "entries", pluginId, "config", "rings", ...path];
}

export function resolveRingsTimezoneDefault(
  configObject: Record<string, unknown> | null,
): string | null {
  const agents = asConfigRecord(configObject?.agents);
  const defaults = asConfigRecord(agents?.defaults);
  const timezone = defaults?.userTimezone;
  return typeof timezone === "string" && timezone.trim() ? timezone.trim() : null;
}
