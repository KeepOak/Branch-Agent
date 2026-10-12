// Compile once per test invocation so process-exit proof uses packaged worker startup.
export const stateLeaseProcessExitRuntimeEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "branch-state-lease-process-exit-child.test-support",
  distWorkerPath: "state/branch-state-lease-process-exit-child.test-support.js",
} as const;

export const stateLeaseRetentionRuntimeEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "branch-state-lease.retention.test-support",
  distWorkerPath: "state/branch-state-lease.retention.test-support.js",
} as const;

export const agentDatabaseHeldRuntimeEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "branch-agent-db-held-child.test-support",
  distWorkerPath: "state/branch-agent-db-held-child.test-support.js",
} as const;
