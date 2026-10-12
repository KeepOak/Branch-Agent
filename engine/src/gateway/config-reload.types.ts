import type { ConfigWriteNotification } from "../config/io.js";
import type { RuntimeConfigSnapshotRefreshOptions } from "../config/runtime-snapshot.js";
import type { RuntimeConfigWriteApplicationClaim } from "../config/runtime-write-application.js";
import type { ConfigFileSnapshot, BranchConfig } from "../config/types.branch.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import type { GatewayScheduler } from "../infra/gateway-scheduler.js";
import type { GatewayReloadPlan } from "./config-reload-plan.js";
import type { GatewayHotReloadApplication } from "./config-reload-status.types.js";

export type InProcessConfigCandidate = {
  config: BranchConfig;
  compareConfig: BranchConfig;
  persistedHash: string;
  afterWrite?: ConfigWriteNotification["afterWrite"];
  preparedCandidate?: ConfigWriteNotification["preparedCandidate"];
  runtimeRefresh?: RuntimeConfigSnapshotRefreshOptions;
  application?: RuntimeConfigWriteApplicationClaim;
  epoch: number;
  snapshot: ConfigFileSnapshot;
};

export type GatewayConfigReloadTransactionOwnership = {
  isCurrent: () => boolean;
  checkpoint: () => Promise<void>;
  withRestartPreparation: <T>(
    run: (ownership: GatewayConfigReloadTransactionOwnership) => Promise<T>,
  ) => Promise<T>;
  assertInvokerOwned?: () => void;
  markRuntimeCommitted: (runtimeConfig: BranchConfig, plan: GatewayReloadPlan) => void;
  commitRuntimeEnv: () => void;
  publishRuntimeEnv: () => void;
  rollbackRuntimeEnv: () => void;
  reapplyRuntimeOverlays: (config: BranchConfig) => BranchConfig;
  runtimeEnv?: NonNullable<ConfigWriteNotification["preparedCandidate"]>["runtimeEnv"];
  runtimeRefresh?: RuntimeConfigSnapshotRefreshOptions;
};

type PreparedGatewayConfigCandidate = {
  runtimeConfig: BranchConfig;
  compareConfig: BranchConfig;
  runtimeEnv?: NonNullable<ConfigWriteNotification["preparedCandidate"]>["runtimeEnv"];
  reapplyRuntimeOverlays?: (config: BranchConfig) => BranchConfig;
  reapplyCompareOverlays?: (config: BranchConfig) => BranchConfig;
};

export type PluginInstallRecords = Record<string, PluginInstallRecord>;

export type GatewayConfigReloaderOptions = {
  scheduler: GatewayScheduler;
  initialConfig: BranchConfig;
  initialCompareConfig?: BranchConfig;
  initialSnapshotRawHash: string | null;
  initialAuthoredConfig: unknown;
  initialIncludedPaths?: readonly string[];
  initialSnapshotValid: boolean;
  initialSnapshotIssues: ConfigFileSnapshot["issues"];
  /** Keeps watcher-heavy tests immediate without reopening config-level debounce tuning. */
  testDebounceMs?: number;
  /** Per-instance test hook for synchronizing filesystem edits with watcher startup. */
  onWatcherReady?: () => void;
  /** Source acceptance controls ancillary reload owners even when runtime application is off. */
  onReloadEnabledChange?: (enabled: boolean) => void;
  prepareConfigCandidate?: (params: {
    runtimeConfig: BranchConfig;
    sourceConfig: BranchConfig;
    previousSourceConfig: BranchConfig;
  }) => Promise<PreparedGatewayConfigCandidate>;
  readSnapshot: (activeSourceConfig: BranchConfig) => Promise<ConfigFileSnapshot>;
  /** Pauses restart emission synchronously when a matching disk candidate is observed. */
  onConfigCandidateObserved?: () => void;
  onConfigChange?: (plan: GatewayReloadPlan, nextConfig: BranchConfig) => void | Promise<void>;
  /** Publishes runtime state after a hot or no-op config transaction. */
  onConfigApplied?: (plan: GatewayReloadPlan, nextConfig: BranchConfig) => void | Promise<void>;
  /** Runs synchronously when a config transaction publishes its runtime state. */
  onRuntimeConfigCommitted?: (plan: GatewayReloadPlan, nextConfig: BranchConfig) => void;
  /** Publishes the resolved source-config revision accepted by the active runtime. */
  onConfigRevisionApplied?: (hash: string) => void;
  /** Reads the same restart owner that fences publication of the applied revision. */
  hasOutstandingGatewayRestart?: () => boolean;
  /** Retires rejected lifecycle work after any newer config transaction is accepted. */
  onConfigAccepted?: (
    nextConfig: BranchConfig,
    ownership: GatewayConfigReloadTransactionOwnership,
    sourceConfig: BranchConfig,
    acceptance: {
      runtimeApplied: boolean;
      publishSource?: () => Promise<void>;
    },
  ) => void | Promise<void>;
  /** Publishes a newer source snapshot when effective runtime bytes are unchanged. */
  onEffectiveConfigUnchanged?: (
    nextConfig: BranchConfig,
    ownership: GatewayConfigReloadTransactionOwnership,
    sourceConfig: BranchConfig,
  ) => Promise<{
    rollback: () => Promise<void>;
    /** Runs only when this exact source publication can no longer roll back. */
    commit?: () => void;
  }>;
  /**
   * Fires once per accepted candidate whose persisted content changed —
   * regardless of writer (gateway RPC, agent/CLI config_set, doctor, hand
   * edit) and of whether the runtime applied it. The single notification
   * point for change listeners such as the config.changed broadcast.
   */
  onConfigCandidateCommitted?: (info: {
    path: string;
    persistedHash: string | null;
    changedPaths: readonly string[];
  }) => void;
  onNoopConfigCommit: (
    plan: GatewayReloadPlan,
    nextConfig: BranchConfig,
    ownership: GatewayConfigReloadTransactionOwnership,
    sourceConfig: BranchConfig,
  ) => Promise<void | GatewayHotReloadApplication>;
  onHotReload: (
    plan: GatewayReloadPlan,
    nextConfig: BranchConfig,
    ownership: GatewayConfigReloadTransactionOwnership,
    sourceConfig: BranchConfig,
  ) => Promise<GatewayHotReloadApplication>;
  onRestart: (
    plan: GatewayReloadPlan,
    nextConfig: BranchConfig,
    ownership: GatewayConfigReloadTransactionOwnership,
    sourceConfig: BranchConfig,
  ) => void | Promise<void>;
  /** Keeps one accepted config transaction inside the Gateway work fence. */
  runTransaction?: <T>(run: () => Promise<T>) => Promise<T>;
  promoteSnapshot?: (snapshot: ConfigFileSnapshot, reason: string) => Promise<boolean>;
  initialPluginInstallRecords?: PluginInstallRecords;
  readPluginInstallRecords?: () => Promise<PluginInstallRecords>;
  subscribeToWrites?: (listener: (event: ConfigWriteNotification) => void) => () => void;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  watchPath: string;
};
