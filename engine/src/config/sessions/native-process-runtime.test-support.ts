export const sessionNativeProcessEntrypoints = {
  accessor: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "session-accessor",
    distWorkerPath: "config/sessions/session-accessor.js",
  },
  canonicalReadiness: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "session-canonical-validation-readiness",
    distWorkerPath: "config/sessions/session-canonical-validation-readiness.js",
  },
  databaseReadOnly: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/branch-agent-db-readonly-open",
    distWorkerPath: "state/branch-agent-db-readonly-open.js",
  },
  databaseValidation: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/branch-agent-db-validation-cache",
    distWorkerPath: "state/branch-agent-db-validation-cache.js",
  },
  databaseRegistry: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../../state/branch-agent-db-registry",
    distWorkerPath: "state/branch-agent-db-registry.js",
  },
} as const;
