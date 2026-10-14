/**
 * Codex runtime availability for the Branch Agent window: which Codex runs
 * (PATH, bundled or downloaded), or the Download/unavailable state with its
 * reason, and a way to start the first-use download ahead of the first turn.
 */
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { resolveStateDir } from "branch/plugin-sdk/state-paths";
import {
  resolveManagedCodexNativeCommand,
  resolveManagedCodexPackageEntrypoint,
  setManagedCodexOnDemand,
} from "./app-server/managed-binary.js";
import { createCodexOnDemand, type CodexOnDemand } from "./app-server/on-demand.js";

/** Creates the plugin's on-demand Codex source and its codex.runtime gateway methods. */
export function registerCodexRuntime(
  api: Pick<BranchPluginApi, "rootDir" | "registerGatewayMethod">,
): CodexOnDemand {
  const onDemand = createCodexOnDemand({
    stateDir: () => resolveStateDir(),
    launcherEntrypoint: () =>
      api.rootDir ? resolveManagedCodexPackageEntrypoint(api.rootDir) : undefined,
    bundledReady: (launcher) => resolveManagedCodexNativeCommand(launcher) !== undefined,
  });
  setManagedCodexOnDemand(onDemand);
  api.registerGatewayMethod(
    "codex.runtime",
    async ({ respond }) => {
      respond(true, await onDemand.status());
    },
    { scope: "operator.read" },
  );
  api.registerGatewayMethod(
    "codex.runtime.download",
    async ({ respond }) => {
      const before = await onDemand.status();
      if (before.state === "download" || before.state === "unavailable") {
        // The download continues after this reply; codex.runtime reports its progress or reason.
        void onDemand.ensureLauncher().catch(() => undefined);
      }
      respond(true, await onDemand.status());
    },
    { scope: "operator.admin" },
  );
  return onDemand;
}
