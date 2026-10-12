// Fresh database workers share compiled backend code, never database state.
export const canopySqliteBackendEntrypoint = {
  currentModuleUrl: import.meta.url,
  sourceWorkerName: "sqlite-store.worker",
  distWorkerPath: "extensions/canopy/src/sqlite-store.worker.js",
} as const;
