import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
  PluginStateSyncKeyedStore,
} from "branch/plugin-sdk/plugin-state-runtime";
import {
  createPluginStateKeyedStoreForTests,
  createPluginStateSyncKeyedStoreForTests,
  resetPluginStateStoreForTests,
} from "branch/plugin-sdk/plugin-state-test-runtime";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";
import { importFreshModule } from "branch/plugin-sdk/test-fixtures";
import { afterEach, beforeEach, vi } from "vitest";
import { registerBrowserPlugin } from "../../plugin-registration.js";
import type { BranchPluginApi } from "../../runtime-api.js";
import { useAutoCleanupTempDirTracker } from "../../test-support.js";
import type { closeTrackedCdpTarget } from "./cdp.helpers.js";
import type { RegistryModule } from "./session-tab-registry.sqlite.test-helpers.js";
import { ensureBrowserSessionTabStoreReady } from "./session-tab-store.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

const cdpMocks = vi.hoisted(() => ({
  closeTrackedCdpTarget: vi.fn<typeof closeTrackedCdpTarget>(),
}));

export { cdpMocks };

vi.mock("./cdp.helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cdp.helpers.js")>()),
  closeTrackedCdpTarget: cdpMocks.closeTrackedCdpTarget,
}));

export function clearProcessLocalTabState(): void {
  const state = globalThis as Record<symbol, unknown>;
  for (const name of [
    "branch.browser.session-tabs.volatile",
    "branch.browser.session-tabs.volatile-cleanup",
    "branch.browser.session-tabs.active-durable-keys",
    "branch.browser.session-tabs.cold-native-activity",
    "branch.browser.session-tabs.interaction-storage-keys",
    "branch.browser.session-tabs.exact-interaction-storage-keys",
    "branch.browser.session-tabs.volatile-aliases",
    "branch.browser.session-tabs.exact-volatile-aliases",
    "branch.browser.session-tabs.deferred-diagnostics",
  ]) {
    delete state[Symbol.for(name)];
  }
}

export function installSessionTabRegistrySqliteHarness() {
  const originalStateDir = process.env.BRANCH_STATE_DIR;
  let freshModuleCounter = 0;

  function openStore(): PluginStateSyncKeyedStore<unknown> {
    return createPluginStateSyncKeyedStoreForTests("browser", {
      namespace: "browser.session-tabs",
      maxEntries: 5_000,
      overflowPolicy: "reject-new",
    });
  }

  async function installRuntime(
    openKeyedStore: (options: OpenKeyedStoreOptions) => PluginStateKeyedStore<unknown> = (
      options,
    ) => createPluginStateKeyedStoreForTests("browser", options),
  ): Promise<void> {
    registerBrowserPlugin(
      createTestPluginApi({
        id: "browser",
        name: "Browser",
        source: "test",
        rootDir: "/plugins/browser",
        config: {},
        runtime: {
          state: {
            openKeyedStore,
          },
        } as unknown as BranchPluginApi["runtime"],
      }),
    );
    await ensureBrowserSessionTabStoreReady();
  }

  async function freshRegistry(label: string): Promise<RegistryModule> {
    freshModuleCounter += 1;
    return await importFreshModule<RegistryModule>(
      import.meta.url,
      `./session-tab-registry.js?durable=${label}-${freshModuleCounter}`,
    );
  }

  beforeEach(async () => {
    clearRuntimeConfigSnapshot();
    clearProcessLocalTabState();
    process.env.BRANCH_STATE_DIR = tempDirs.make("branch-browser-tabs-");
    resetPluginStateStoreForTests();
    await installRuntime();
    openStore().clear();
    cdpMocks.closeTrackedCdpTarget
      .mockReset()
      .mockImplementation(async ({ closeIfCurrent }) =>
        closeIfCurrent
          ? await closeIfCurrent(async () => ({ status: "closed" }))
          : { status: "closed" },
      );
  });

  afterEach(() => {
    clearRuntimeConfigSnapshot();
    clearProcessLocalTabState();
    resetPluginStateStoreForTests();
    if (originalStateDir === undefined) {
      delete process.env.BRANCH_STATE_DIR;
    } else {
      process.env.BRANCH_STATE_DIR = originalStateDir;
    }
  });

  return { openStore, installRuntime, freshRegistry };
}

export function setBrowserProfileConfig(): void {
  const config = {
    browser: {
      defaultProfile: "remote",
      profiles: {
        remote: {
          driver: "existing-session",
          cdpUrl: "http://127.0.0.1:9222",
          color: "#123456",
        },
      },
    },
  } satisfies BranchConfig;
  setRuntimeConfigSnapshot(config, config);
}
