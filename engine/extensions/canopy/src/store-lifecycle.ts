import type { BranchPluginApi } from "../api.js";
import type { CanopyStore } from "./store.js";

export function registerCanopyStoreLifecycle(
  api: BranchPluginApi,
  store: CanopyStore,
  stopServices?: () => void | Promise<void>,
): void {
  const dispose = async () => {
    // Stop producers before the store drains admitted work and closes its connection.
    await stopServices?.();
    await store.close();
  };
  api.lifecycle.registerRuntimeLifecycle({
    id: "canopy-sqlite-store",
    dispose,
    cleanup: ({ reason, sessionKey, runId }) => {
      // Session cleanup shares this hook, but only registry retirement owns the whole store.
      if (
        sessionKey === undefined &&
        runId === undefined &&
        (reason === "disable" || reason === "restart")
      ) {
        return dispose();
      }
      return undefined;
    },
  });
}
