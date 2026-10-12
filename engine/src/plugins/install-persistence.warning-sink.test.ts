import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  configWriteMock,
  createEmptyUninstallActions,
  applyPluginUninstallDirectoryRemovalMock,
  buildPluginSnapshotReportMock,
  loadPluginManifestRegistryMock,
  planPluginUninstallMock,
  refreshPluginRegistryMock,
  readConfigFileSnapshotForWriteMock,
  resetPluginsCliTestState,
  pluginsCliRuntimeLogs,
  setInstalledPluginIndexInstallRecords,
} from "../cli/plugins-cli-test-helpers.js";
import { createTestConfigSnapshot } from "../commands/test-runtime-config-helpers.js";
import type { PluginInstallRuntimeDeferral } from "./install-runtime-batch.js";
import { recordPluginManifestInstallOwner } from "./manifest-install-owner.js";

const snapshot = {
  config: {},
  baseHash: "config-1",
  writeOptions: { expectedConfigPath: "/tmp/branch.json" },
};

const install = {
  source: "npm" as const,
  spec: "canopy@1.0.0",
  installPath: "/private/managed-source/canopy",
};

describe("plugin install persistence warning audiences", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: { ...createTestConfigSnapshot(snapshot.config), hash: snapshot.baseHash },
      writeOptions: snapshot.writeOptions,
    });
  });

  it("delivers deferred source cleanup warnings to the live batch consumer", async () => {
    const { persistPluginInstall } = await import("./install-persistence.js");
    const cleanups: Parameters<PluginInstallRuntimeDeferral["deferCleanup"]>[0][] = [];
    const lateWarning = vi.fn();
    const warning = "Previous plugin source could not be removed";
    setInstalledPluginIndexInstallRecords({
      canopy: { source: "clawhub", installPath: "/private/previous-source/canopy" },
    });
    planPluginUninstallMock.mockReturnValueOnce({
      ok: true,
      config: {},
      pluginId: "canopy",
      actions: createEmptyUninstallActions(),
      directoryRemoval: { target: "/private/previous-source/canopy" },
    });
    applyPluginUninstallDirectoryRemovalMock.mockResolvedValueOnce({
      directoryRemoved: false,
      warnings: [warning],
    });
    await persistPluginInstall({
      snapshot,
      pluginId: "canopy",
      install,
      enable: false,
      runtime: { log: () => {} },
      persistenceLogger: { warn: () => {} },
      deferRuntime: { record: () => {}, deferCleanup: (cleanup) => cleanups.push(cleanup) },
    });
    expect(applyPluginUninstallDirectoryRemovalMock).not.toHaveBeenCalled();
    expect(cleanups).toHaveLength(1);
    await cleanups[0]!(() => {}, lateWarning);
    expect(lateWarning).toHaveBeenCalledExactlyOnceWith(warning);
  });

  it("reports missing required configuration without forwarding informational logs", async () => {
    const { persistPluginInstall } = await import("./install-persistence.js");
    const warn = vi.fn();
    loadPluginManifestRegistryMock.mockReturnValue({
      plugins: [
        recordPluginManifestInstallOwner(
          {
            id: "canopy",
            manifestPath: `${install.installPath}/branch.plugin.json`,
            configSchema: {
              type: "object",
              required: ["token"],
              properties: { token: { type: "string" } },
            },
          },
          "canopy",
        ),
      ],
      diagnostics: [],
    });

    const next = await persistPluginInstall({
      snapshot,
      pluginId: "canopy",
      install,
      persistenceLogger: { warn },
    });

    expect(next.plugins?.entries?.canopy).toEqual({ enabled: false });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Installed plugin "canopy" without enabling it because it requires configuration first. Configure it, then run `branch plugins enable canopy`.',
    );
    expect(pluginsCliRuntimeLogs.join("\n")).toContain("requires configuration first");
    expect(pluginsCliRuntimeLogs).toContain("Installed plugin: canopy");
  });

  it.each(["management", "terminal"] as const)(
    "keeps sensitive install details appropriate for the %s audience",
    async (audience) => {
      const { persistPluginInstall } = await import("./install-persistence.js");
      const warn = vi.fn();
      const cleanupDetail = "npm stderr PRIVATE_NPM_MARKER /private/previous-source/canopy";
      const refreshDetail = "PRIVATE_REFRESH_MARKER /private/registry-source/canopy";
      const configuredSource = "/private/configured-source/canopy/index.js";
      setInstalledPluginIndexInstallRecords({
        canopy: {
          source: "clawhub",
          spec: "clawhub:community/canopy",
          installPath: "/private/previous-source/canopy",
        },
      });
      planPluginUninstallMock.mockReturnValueOnce({
        ok: true,
        config: {},
        pluginId: "canopy",
        actions: createEmptyUninstallActions(),
        directoryRemoval: { target: "/private/previous-source/canopy" },
      });
      applyPluginUninstallDirectoryRemovalMock.mockResolvedValueOnce({
        directoryRemoved: false,
        warnings: [cleanupDetail],
      });
      refreshPluginRegistryMock.mockImplementationOnce(async () => {
        expect(configWriteMock).toHaveBeenCalledOnce();
        throw new Error(refreshDetail);
      });
      buildPluginSnapshotReportMock.mockReturnValue({
        plugins: [{ id: "canopy", origin: "config", source: configuredSource }],
        diagnostics: [],
      });

      await persistPluginInstall({
        snapshot,
        pluginId: "canopy",
        install,
        ...(audience === "management" ? { persistenceLogger: { warn } } : {}),
      });

      if (audience === "terminal") {
        expect(warn).not.toHaveBeenCalled();
      } else {
        const warnings = warn.mock.calls.map(([message]) => String(message));
        expect(warnings).toHaveLength(3);
        expect(warnings.join("\n")).toContain("previous plugin installation");
        expect(warnings.join("\n")).toContain("registry");
        expect(warnings.join("\n")).toContain("shadowed");
        expect(warnings.join("\n")).not.toContain("/private/");
        expect(warnings.join("\n")).not.toContain("PRIVATE_NPM_MARKER");
        expect(warnings.join("\n")).not.toContain("PRIVATE_REFRESH_MARKER");
      }
      expect(pluginsCliRuntimeLogs.join("\n")).toContain(cleanupDetail);
      expect(pluginsCliRuntimeLogs.join("\n")).toContain(refreshDetail);
      expect(pluginsCliRuntimeLogs.join("\n")).toContain(configuredSource);
      expect(pluginsCliRuntimeLogs.join("\n")).toContain(install.installPath);
    },
  );
});
