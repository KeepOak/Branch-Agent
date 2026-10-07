import type { LegacyConfigMigrationContext } from "../../../config/legacy.shared.js";
import type { BranchConfig } from "../../../config/types.js";
import { LEGACY_CONFIG_MIGRATIONS } from "./legacy-config-migrations.js";

export function migrateLegacyConfigForTest(
  raw: unknown,
  context?: LegacyConfigMigrationContext,
): {
  config: BranchConfig | null;
  changes: string[];
} {
  if (!raw || typeof raw !== "object") {
    return { config: null, changes: [] };
  }
  const next = structuredClone(raw) as Record<string, unknown>;
  const changes: string[] = [];
  for (const migration of LEGACY_CONFIG_MIGRATIONS) {
    migration.apply(next, changes, context);
  }
  const visibleChanges = changes.filter(
    (change) => change !== "Moved agents.list → keyed agents.entries.",
  );
  return visibleChanges.length === 0
    ? { config: null, changes: visibleChanges }
    : { config: next as BranchConfig, changes: visibleChanges };
}
