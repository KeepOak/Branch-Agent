/**
 * Codex runtime availability for the Branch Agent window: which Codex runs
 * (PATH, bundled or downloaded), or the Download/unavailable state with its
 * reason, a way to start the first-use download ahead of the first turn, and
 * Cancel for a download in progress (the chat's "Getting Codex ready…" line).
 */
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { resolveStateDir } from "branch/plugin-sdk/state-paths";
import {
  resolveManagedCodexNativeCommand,
  resolveManagedCodexPackageEntrypoint,
  setManagedCodexOnDemand,
} from "./app-server/managed-binary.js";
import {
  createCodexOnDemand,
  type CodexOnDemand,
  type CodexOnDemandDeps,
} from "./app-server/on-demand.js";

/** Creates the plugin's on-demand Codex source and its codex.runtime gateway methods. */
export function registerCodexRuntime(
  api: Pick<BranchPluginApi, "rootDir" | "registerGatewayMethod">,
  /** Tests: fixture fetch, state folder and platform. */
  overrides: Partial<CodexOnDemandDeps> = {},
): CodexOnDemand {
  const onDemand = createCodexOnDemand({
    stateDir: () => resolveStateDir(),
    launcherEntrypoint: () =>
      api.rootDir ? resolveManagedCodexPackageEntrypoint(api.rootDir) : undefined,
    bundledReady: (launcher) => resolveManagedCodexNativeCommand(launcher) !== undefined,
    ...overrides,
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
    async ({ params, respond }) => {
      const before = await onDemand.status();
      // The window asks first. Without the owner's yes, this reports the question and fetches nothing.
      if (params?.confirmed !== true) {
        respond(true, before);
        return;
      }
      onDemand.allowDownload();
      if (before.state === "download" || before.state === "unavailable") {
        // The download continues after this reply; codex.runtime reports its progress or reason.
        void onDemand.ensureLauncher().catch(() => undefined);
      }
      respond(true, await onDemand.status());
    },
    { scope: "operator.admin" },
  );
  api.registerGatewayMethod(
    "codex.runtime.cancel",
    async ({ respond }) => {
      // Aborts the fetch and deletes the partial file before answering; the
      // waiting turn ends with "Cancelled" and Codex stays "not downloaded".
      const cancelled = await onDemand.cancel();
      respond(true, { cancelled, ...(await onDemand.status()) });
    },
    { scope: "operator.write" },
  );
  return onDemand;
}
