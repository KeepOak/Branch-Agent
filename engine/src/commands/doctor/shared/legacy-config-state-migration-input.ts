import type { ConfigFileSnapshot } from "../../../config/types.js";
import type { BranchConfig } from "../../../config/types.branch.js";
import { migrateLegacyConfig } from "./legacy-config-migrate.js";

type StateMigrationConfigInput = {
  cfg?: BranchConfig;
  pluginDoctorConfig?: BranchConfig;
};

export function resolveStateMigrationConfigInput(params: {
  snapshot: ConfigFileSnapshot;
  baseConfig: BranchConfig;
  /** Validated runtime projection from the guarded post-convergence repair plan. */
  postConvergenceConfig?: BranchConfig;
}): StateMigrationConfigInput | null {
  const pluginDoctorConfig = (params.snapshot.sourceConfig ??
    params.snapshot.config ??
    params.snapshot.parsed) as BranchConfig | undefined;
  if (params.postConvergenceConfig) {
    return {
      cfg: params.postConvergenceConfig,
      ...(pluginDoctorConfig ? { pluginDoctorConfig } : {}),
    };
  }
  if (params.snapshot.valid) {
    return params.snapshot.legacyIssues.length > 0 && pluginDoctorConfig !== undefined
      ? { cfg: params.baseConfig, pluginDoctorConfig }
      : { cfg: params.baseConfig };
  }
  const migrationSource = pluginDoctorConfig ?? params.snapshot.parsed;
  if (params.snapshot.legacyIssues.length === 0 || migrationSource === undefined) {
    return null;
  }
  const migrated = migrateLegacyConfig(migrationSource, {
    sourceConfigBeforeMigrations: params.snapshot.sourceConfigBeforeMigrations,
  });
  // Plugin config repair may retain a legacy locator until its state migration
  // completes. No config mutation must not prevent that owner from retrying.
  if (!migrated.config || migrated.partiallyValid) {
    return {
      pluginDoctorConfig: (pluginDoctorConfig ?? migrationSource) as BranchConfig,
    };
  }
  return {
    cfg: migrated.config,
    ...(pluginDoctorConfig ? { pluginDoctorConfig } : {}),
  };
}
