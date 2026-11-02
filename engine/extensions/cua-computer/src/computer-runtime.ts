/**
 * Computer-use availability over the gateway: whether the CUA Driver is
 * bundled or downloaded, or the download / downloading / unavailable state
 * with its reason, a way to start the first-use download (using computer use
 * starts it), and cancel / retry.
 */
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { resolveStateDir } from "branch/plugin-sdk/state-paths";
import { bundledCuaDriverReady, setComputerUseOnDemand } from "./driver-artifacts.js";
import {
  createComputerUseOnDemand,
  type ComputerUseOnDemand,
  type ComputerUseOnDemandDeps,
} from "./on-demand.js";

/** Creates the plugin's on-demand driver source and its computer.runtime gateway methods. */
export function registerComputerUseRuntime(
  api: Pick<BranchPluginApi, "registerGatewayMethod">,
  /** Tests: fixture fetch, state folder and platform. */
  overrides: Partial<ComputerUseOnDemandDeps> = {},
): ComputerUseOnDemand {
  const onDemand = createComputerUseOnDemand({
    stateDir: () => resolveStateDir(),
    bundledReady: bundledCuaDriverReady,
    ...overrides,
  });
  setComputerUseOnDemand(onDemand);
  api.registerGatewayMethod(
    "computer.runtime",
    async ({ respond }) => {
      respond(true, await onDemand.status());
    },
    { scope: "operator.read" },
  );
  api.registerGatewayMethod(
    "computer.runtime.download",
    async ({ respond }) => {
      const before = await onDemand.status();
      if (before.state === "download" || before.state === "unavailable") {
        // Download now, or retry after a failure: the download continues after this reply and
        // computer.runtime reports its progress or the reason it stopped.
        void onDemand.ensureInstalled({ retry: true }).catch(() => undefined);
      }
      respond(true, await onDemand.status());
    },
    { scope: "operator.admin" },
  );
  api.registerGatewayMethod(
    "computer.runtime.cancel",
    async ({ respond }) => {
      // Aborts the fetch and deletes the partial files before answering;
      // computer use stays "not downloaded".
      const cancelled = await onDemand.cancel();
      respond(true, { cancelled, ...(await onDemand.status()) });
    },
    { scope: "operator.admin" },
  );
  return onDemand;
}
