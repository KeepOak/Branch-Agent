import type { CanopyChange } from "@branch/canopy-contract";
import type { BranchPluginService } from "../api.js";
import type { CanopyStore } from "./store.js";

const CANOPY_EXTERNAL_CHANGE_CHECK_MS = 1000;

export function createCanopyChangeEventService(
  store: Pick<
    CanopyStore,
    "ready" | "subscribeChanges" | "announceChangeEpoch" | "reconcileExternalChanges"
  >,
): BranchPluginService & { stop: () => Promise<void> } {
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let starting: { generation: number; promise: Promise<void> } | undefined;
  let polling: Promise<void> | undefined;

  return {
    id: "canopy-change-events",
    start(ctx) {
      const gatewayEvents = ctx.gatewayEvents;
      if (!gatewayEvents || unsubscribe) {
        return Promise.resolve();
      }
      if (starting?.generation === generation) {
        return starting.promise;
      }
      const currentGeneration = generation;
      const previous = starting?.promise;
      const pending = (async () => {
        await previous?.catch(() => undefined);
        await store.ready();
        if (currentGeneration !== generation) {
          return;
        }
        const emit = (change: CanopyChange) => {
          gatewayEvents.emit("changed", change, {
            scope: "operator.read",
          });
        };
        unsubscribe = store.subscribeChanges(emit);
        store.announceChangeEpoch();
        timer = setInterval(() => {
          if (polling) {
            return;
          }
          polling = store
            .reconcileExternalChanges()
            .then(
              () => undefined,
              (error: unknown) => {
                ctx.logger.warn(`canopy external change check failed: ${String(error)}`);
              },
            )
            .finally(() => {
              polling = undefined;
            });
        }, CANOPY_EXTERNAL_CHANGE_CHECK_MS);
        timer.unref?.();
      })().finally(() => {
        if (starting?.promise === pending) {
          starting = undefined;
        }
      });
      starting = { generation: currentGeneration, promise: pending };
      return pending;
    },
    stop() {
      generation += 1;
      unsubscribe?.();
      unsubscribe = undefined;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      return Promise.allSettled([starting?.promise, polling]).then(() => undefined);
    },
  };
}
