// Native state probes share the invocation's compiled graph before starting child deadlines.
export const stateNativeProcessEntrypoints = {
  agentDatabase: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "branch-agent-db",
    distWorkerPath: "state/branch-agent-db.js",
  },
  stateDatabase: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "branch-state-db",
    distWorkerPath: "state/branch-state-db.js",
  },
  stateDatabaseCache: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "branch-state-db-cache",
    distWorkerPath: "state/branch-state-db-cache.js",
  },
  stateLease: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "branch-state-lease",
    distWorkerPath: "state/branch-state-lease.js",
  },
  loggingState: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../logging/state",
    distWorkerPath: "logging/state.js",
  },
  gatewayStateOwner: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../infra/gateway-state-owner",
    distWorkerPath: "infra/gateway-state-owner.js",
  },
  sqliteReadOnlyLocation: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../infra/sqlite-readonly-location",
    distWorkerPath: "infra/sqlite-readonly-location.js",
  },
  nodeSqlite: {
    currentModuleUrl: import.meta.url,
    sourceWorkerName: "../infra/node-sqlite",
    distWorkerPath: "infra/node-sqlite.js",
  },
} as const;
