import type { DeferredPluginMigration } from "../infra/deferred-plugin-migrations.js";
import type { BranchConfig, RuntimeConfig } from "./types.branch.js";
import type {
  PreparedConfigValidationPluginMetadata,
  ValidateConfigWithPluginsResult,
} from "./validation.types.js";

// The host operation needs reader inputs, not the config I/O implementation or registry.
export type ConfigSnapshotPreparationContext = {
  deps: { env: NodeJS.ProcessEnv };
  pathResolution: { env: NodeJS.ProcessEnv; homedir?: () => string };
  options: {
    pluginValidation?: "full" | "skip" | "core-only";
    preservedLegacyRootKeys?: readonly string[];
  };
  resolveDeferredPluginMigrationsAsync: () => Promise<readonly DeferredPluginMigration[]>;
};

export type ConfigSnapshotMetadataLoader = {
  load: (
    config: BranchConfig,
  ) => Pick<PreparedConfigValidationPluginMetadata, "manifestRegistry">;
  loadAsync: (config: BranchConfig) => Promise<PreparedConfigValidationPluginMetadata>;
};

export type ValidationRequest = {
  kind: "validate";
  prepareValidation?: "runtime" | "strict";
  context: ConfigSnapshotPreparationContext;
  metadata: ConfigSnapshotMetadataLoader;
  raw: unknown;
  sourceRaw: unknown;
};
export type MaterializationRequest = {
  kind: "materialize";
  context: ConfigSnapshotPreparationContext;
  metadata: ConfigSnapshotMetadataLoader;
  config: BranchConfig;
};
export type MetadataRequest = {
  kind: "metadata";
  metadata: ConfigSnapshotMetadataLoader;
  config: BranchConfig;
};
export type PreparedValidation = {
  deferredPluginMigrations: readonly DeferredPluginMigration[];
  validated: ValidateConfigWithPluginsResult;
};

export type ConfigSnapshotPreparation = {
  (request: ValidationRequest): Promise<PreparedValidation>;
  (request: MaterializationRequest): Promise<RuntimeConfig>;
  (request: MetadataRequest): Promise<PreparedConfigValidationPluginMetadata>;
};
export type CapturedConfigSnapshotPreparation = {
  <T>(operation: (prepare: ConfigSnapshotPreparation) => Promise<T>): Promise<T>;
  assertCurrent: () => void;
};
