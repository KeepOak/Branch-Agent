import type { BranchPluginService } from "branch/plugin-sdk/plugin-entry";
import {
  startLazyPluginServiceModule,
  type LazyPluginServiceHandle,
} from "branch/plugin-sdk/plugin-runtime";
import { isTruthyEnvValue } from "branch/plugin-sdk/runtime-env";

const EAGER_BROWSER_CONTROL_SERVICE_ENV = "BRANCH_EAGER_BROWSER_CONTROL_SERVER";
const UNSAFE_BROWSER_CONTROL_OVERRIDE_SPECIFIER = /^(?:data|http|https|node):/i;

function validateBrowserControlOverrideSpecifier(specifier: string): string {
  const trimmed = specifier.trim();
  if (UNSAFE_BROWSER_CONTROL_OVERRIDE_SPECIFIER.test(trimmed)) {
    throw new Error(`Refusing unsafe browser control override specifier: ${trimmed}`);
  }
  return trimmed;
}

export function createBrowserPluginService(params: {
  stopOnDemand: () => Promise<void>;
}): BranchPluginService {
  let handle: LazyPluginServiceHandle | null = null;

  return {
    id: "browser-control",
    start: async () => {
      if (!isTruthyEnvValue(process.env[EAGER_BROWSER_CONTROL_SERVICE_ENV])) {
        return;
      }
      if (handle) {
        return;
      }
      handle = await startLazyPluginServiceModule({
        skipEnvVar: "BRANCH_SKIP_BROWSER_CONTROL_SERVER",
        overrideEnvVar: "BRANCH_BROWSER_CONTROL_MODULE",
        validateOverrideSpecifier: validateBrowserControlOverrideSpecifier,
        // Keep the default module import static so compiled builds still bundle it.
        loadDefaultModule: async () => await import("./server.js"),
        startExportNames: [
          "startBrowserControlServiceFromConfig",
          "startBrowserControlServerFromConfig",
        ],
        stopExportNames: ["stopBrowserControlService", "stopBrowserControlServer"],
      });
    },
    stop: async () => {
      const current = handle;
      if (current) {
        await current.stop();
        if (handle === current) {
          handle = null;
        }
        return;
      }
      await params.stopOnDemand();
    },
  };
}
