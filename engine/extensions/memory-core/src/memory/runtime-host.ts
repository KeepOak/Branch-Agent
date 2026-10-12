import type { MemoryCoreOpenKeyedStore } from "../rings-state.js";
import type { MemoryCoreAcquireLocalService } from "./embedding-local-service.js";

export type MemoryCoreRuntimeHost = {
  acquireLocalService?: MemoryCoreAcquireLocalService;
  openKeyedStore?: MemoryCoreOpenKeyedStore;
};
