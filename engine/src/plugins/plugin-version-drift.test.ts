/** Tests plugin version drift detection between package, manifest, and install records. */
import { expectDefined } from "@branch/normalization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePluginUpdateSelection } from "../cli/plugins-update-selection.js";
import type { BranchConfig } from "../config/types.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import {
  fetchClawHubPackageDetail,
  resolveLatestVersionFromPackage,
} from "../infra/clawhub-packages.js";
import { fetchNpmPackageTargetStatus } from "../infra/update-check-package-target.js";
import {
  detectPluginVersionDrift,
  resolvePluginVersionDriftRegistryLag,
  resolvePluginVersionDriftUpdateCommand,
  resolvePluginVersionDriftTargets,
} from "./plugin-version-drift.js";
import { resolveClawHubUpdateSpecs } from "./update-source.js";

vi.mock("../infra/update-check-package-target.js", () => ({
  fetchNpmPackageTargetStatus: vi.fn(),
}));

vi.mock("../infra/clawhub-packages.js", () => ({
  fetchClawHubPackageDetail: vi.fn(),
  resolveLatestVersionFromPackage: vi.fn(),
}));

function npmRecord(
  version: string,
  overrides: Partial<PluginInstallRecord> = {},
): PluginInstallRecord {
  const resolvedName = overrides.resolvedName ?? "@branch/whatsapp";
  return {
    source: "npm",
    spec: `${resolvedName}@latest`,
    resolvedName,
    resolvedVersion: version,
    ...overrides,
  };
}

function clawhubRecord(
  version: string,
  overrides: Partial<PluginInstallRecord> = {},
): PluginInstallRecord {
  return {
    source: "clawhub",
    spec: "clawhub:@branch/whatsapp",
    clawhubPackage: "@branch/whatsapp",
    resolvedVersion: version,
    ...overrides,
  };
}

function resolvedNpmTarget(packageName: string, target: string, version = target) {
  return {
    targetResolution: {
      status: "resolved" as const,
      packageName,
      requestedTarget: target,
      version,
    },
  };
}

describe("detectPluginVersionDrift", () => {
  it("reports plugins whose installed version does not match the gateway", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3", {
          resolvedName: "@branch/whatsapp",
          spec: "@branch/whatsapp@2026.5.3",
        }),
        discord: npmRecord("2026.5.4", { resolvedName: "@branch/discord" }),
      },
    });

    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]).toEqual({
      pluginId: "whatsapp",
      installedVersion: "2026.5.3",
      gatewayVersion: "2026.5.4",
      source: "npm",
      packageName: "@branch/whatsapp",
      spec: "@branch/whatsapp@2026.5.3",
    });
  });

  it("treats a build-qualifier suffix on either side as matching (2026.5.4-1 ≈ 2026.5.4)", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4-1",
      installRecords: {
        whatsapp: npmRecord("2026.5.4"),
        // ...and the inverse direction
        discord: npmRecord("2026.5.4-1", { resolvedName: "@branch/discord" }),
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("includes ClawHub-installed plugins in the drift check", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: clawhubRecord("2026.5.3"),
      },
    });

    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]?.source).toBe("clawhub");
  });

  it("includes official Seedbank installs whose catalog entry only declares npm install metadata", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        slack: clawhubRecord("2026.5.3", {
          spec: "clawhub:@branch/slack",
          clawhubPackage: "@branch/slack",
          clawhubChannel: "official",
          clawhubUrl: "https://clawhub.ai",
        }),
      },
    });

    expect(result.drifts.map((d) => d.pluginId)).toEqual(["slack"]);
  });

  it("ignores community npm installs without an official lockstep contract", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        community: npmRecord("1.2.3", {
          resolvedName: "community-plugin",
          spec: "community-plugin@1.2.3",
        }),
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("ignores community Seedbank installs without an official lockstep contract", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        community: clawhubRecord("1.2.3", {
          spec: "clawhub:community-plugin@1.2.3",
          clawhubPackage: "community-plugin",
        }),
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("ignores official catalog installs pinned to independent package versions", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        "branch-plugin-yuanbao": npmRecord("2.13.1", {
          resolvedName: "branch-plugin-yuanbao",
          spec: "branch-plugin-yuanbao@2.13.1",
        }),
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("ignores exact catalog pins even when the pin matches the gateway version", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.7",
      installRecords: {
        "wecom-branch-plugin": npmRecord("2026.5.6", {
          resolvedName: "@wecom/wecom-branch-plugin",
          spec: "@wecom/wecom-branch-plugin@2026.5.6",
        }),
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("ignores install sources that are not official external installs", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        // archive/path/git installs are local artifacts; they pin to whatever
        // the operator chose and should not be flagged on a gateway version
        // bump alone.
        archive: {
          source: "archive",
          resolvedName: "@branch/whatsapp",
          resolvedVersion: "2026.5.3",
          spec: "@branch/whatsapp@archive",
        },
        local: {
          source: "path",
          resolvedName: "@branch/whatsapp",
          resolvedVersion: "2026.5.3",
          spec: "/tmp/local-plugin",
        },
        forked: {
          source: "git",
          resolvedName: "@branch/whatsapp",
          resolvedVersion: "2026.5.3",
          spec: "git+ssh://example/forked",
        },
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("falls back to the install record's `version` field when `resolvedVersion` is absent", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: {
          source: "npm",
          spec: "@branch/whatsapp@latest",
          resolvedName: "@branch/whatsapp",
          version: "2026.5.3",
        },
      },
    });

    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]?.installedVersion).toBe("2026.5.3");
  });

  it("skips plugins with no recorded version (cannot detect drift)", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: { source: "npm", spec: "@branch/whatsapp@latest" },
      },
    });

    expect(result.drifts).toEqual([]);
  });

  it("skips plugins that are explicitly disabled in config", () => {
    const config: BranchConfig = {
      plugins: {
        entries: {
          whatsapp: { enabled: false },
          discord: { enabled: true },
        },
      },
    } as BranchConfig;

    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3"),
        discord: npmRecord("2026.5.3", { resolvedName: "@branch/discord" }),
      },
      config,
    });

    expect(result.drifts.map((d) => d.pluginId)).toEqual(["discord"]);
  });

  it("skips plugins disabled by the global plugin activation policy", () => {
    const config: BranchConfig = {
      plugins: {
        enabled: false,
      },
    } as BranchConfig;

    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3"),
      },
      config,
    });

    expect(result.drifts).toEqual([]);
  });

  it("skips plugins blocked by denylist or restrictive allowlist policy", () => {
    const denied = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3"),
      },
      config: {
        plugins: {
          deny: ["whatsapp"],
        },
      } as BranchConfig,
    });
    const notAllowed = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3"),
      },
      config: {
        plugins: {
          allow: ["discord"],
        },
      } as BranchConfig,
    });

    expect(denied.drifts).toEqual([]);
    expect(notAllowed.drifts).toEqual([]);
  });

  it("returns drifts sorted by pluginId for deterministic output", () => {
    const result = detectPluginVersionDrift({
      gatewayVersion: "2026.5.4",
      installRecords: {
        whatsapp: npmRecord("2026.5.3"),
        discord: npmRecord("2026.5.3", { resolvedName: "@branch/discord" }),
        matrix: npmRecord("2026.5.3", { resolvedName: "@branch/matrix" }),
      },
    });

    expect(result.drifts.map((d) => d.pluginId)).toEqual(["discord", "matrix", "whatsapp"]);
  });
});

describe("resolvePluginVersionDriftTargets", () => {
  beforeEach(() => vi.mocked(fetchNpmPackageTargetStatus).mockReset());

  function driftReport(
    gatewayVersion = "2026.7.1-2",
    spec = "@branch/brave-plugin@2026.7.1-beta.2",
  ) {
    return detectPluginVersionDrift({
      gatewayVersion,
      installRecords: {
        brave: npmRecord("2026.7.1-beta.2", { resolvedName: "@branch/brave-plugin", spec }),
      },
    });
  }

  it("uses the exact published correction-version cohort for a pinned repair", async () => {
    vi.mocked(fetchNpmPackageTargetStatus).mockResolvedValue({
      version: "2026.7.1",
      nodeEngine: null,
    });
    const report = await resolvePluginVersionDriftTargets(driftReport());
    expect(fetchNpmPackageTargetStatus).toHaveBeenCalledWith({
      packageName: "@branch/brave-plugin",
      target: "2026.7.1",
    });
    expect(
      resolvePluginVersionDriftUpdateCommand(
        expectDefined(report.drifts[0], "detected plugin drift"),
      ),
    ).toBe("branch plugins update @branch/brave-plugin@2026.7.1");
  });

  it.each([{ version: null, error: "HTTP 404" }, { version: null }, { version: "2026.7.1-2" }])(
    "withholds pinned commands when the requested version is unconfirmed: $version $error",
    async (result) => {
      vi.mocked(fetchNpmPackageTargetStatus).mockResolvedValue({
        nodeEngine: null,
        ...result,
      });
      const report = await resolvePluginVersionDriftTargets(driftReport());
      const entry = expectDefined(report.drifts[0], "detected plugin drift");
      expect(entry.targetResolution).toMatchObject({
        status: "unresolved",
        packageName: "@branch/brave-plugin",
        requestedTarget: "2026.7.1",
        error: expect.stringContaining(result.error ?? JSON.stringify(result.version)),
      });
      expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
    },
  );

  it("does not query npm for non-release cohorts or floating installs", async () => {
    const invalid = await resolvePluginVersionDriftTargets(driftReport("unknown"));
    expect(
      resolvePluginVersionDriftUpdateCommand(
        expectDefined(invalid.drifts[0], "invalid-cohort plugin drift"),
      ),
    ).toBeUndefined();
    const floating = await resolvePluginVersionDriftTargets(
      driftReport("2026.7.1", "@branch/brave-plugin@latest"),
    );
    expect(
      resolvePluginVersionDriftUpdateCommand(
        expectDefined(floating.drifts[0], "floating plugin drift"),
      ),
    ).toBe("branch plugins update brave");
    expect(fetchNpmPackageTargetStatus).not.toHaveBeenCalled();
  });
});

describe("resolvePluginVersionDriftTargets for Seedbank installs", () => {
  beforeEach(() => {
    vi.mocked(fetchClawHubPackageDetail).mockReset();
    vi.mocked(resolveLatestVersionFromPackage).mockReset();
    vi.mocked(fetchClawHubPackageDetail).mockResolvedValue(
      {} as Awaited<ReturnType<typeof fetchClawHubPackageDetail>>,
    );
  });

  function clawhubDriftReport(installedVersion: string, gatewayVersion = "2026.9.4") {
    return detectPluginVersionDrift({
      gatewayVersion,
      installRecords: { whatsapp: clawhubRecord(installedVersion) },
    });
  }

  it("explains registry lag when the install already holds the newest Seedbank version", async () => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(clawhubDriftReport("2026.9.3"));
    expect(fetchClawHubPackageDetail).toHaveBeenCalledWith({
      name: "@branch/whatsapp",
      baseUrl: "https://clawhub.ai",
    });
    const entry = expectDefined(report.drifts[0], "registry-current Seedbank install");
    expect(entry.targetResolution).toEqual({
      status: "registry-current",
      packageName: "@branch/whatsapp",
      requestedTarget: "2026.9.4",
      version: "2026.9.3",
    });
    expect(resolvePluginVersionDriftRegistryLag(entry)).toEqual({
      registryVersion: "2026.9.3",
      expectedVersion: "2026.9.4",
    });
    // The observed registry version is already installed, so no update can move it.
    expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
  });

  it.each([
    { installed: "2026.9.3", latest: "2026.9.2" },
    { installed: "2026.9.3-2", latest: "2026.9.3-1" },
    { installed: "2026.9.3-1", latest: "2026.9.3" },
    { installed: "1.2.3", latest: "1.2.2" },
  ])("does not offer a Seedbank downgrade $installed -> $latest", async ({ installed, latest }) => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue(latest);
    const report = await resolvePluginVersionDriftTargets(clawhubDriftReport(installed));
    const entry = expectDefined(report.drifts[0], "Seedbank registry rollback");
    expect(entry.targetResolution).toMatchObject({
      status: "unresolved",
      error: expect.stringContaining("older than installed"),
    });
    expect(resolvePluginVersionDriftRegistryLag(entry)).toBeUndefined();
    expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
  });

  it.each([
    { installed: "2026.9.3", latest: "2026.9.3-1" },
    { installed: "2026.9.3-1", latest: "2026.9.3-2" },
    { installed: "2026.9.3+hotfix.1", latest: "2026.9.3+hotfix.2" },
  ])(
    "offers the available Seedbank correction $installed -> $latest",
    async ({ installed, latest }) => {
      vi.mocked(resolveLatestVersionFromPackage).mockReturnValue(latest);
      const report = await resolvePluginVersionDriftTargets(clawhubDriftReport(installed));
      const entry = expectDefined(report.drifts[0], "available Seedbank correction");
      expect(entry.targetResolution).toMatchObject({ status: "resolved", version: latest });
      expect(resolvePluginVersionDriftRegistryLag(entry)).toBeUndefined();
      expect(resolvePluginVersionDriftUpdateCommand(entry)).toBe(
        "branch plugins update whatsapp",
      );
    },
  );

  it.each(["2026.9.3-1", "2026.9.3+hotfix.2"])(
    "does not prescribe reinstalling the same Seedbank version %s",
    async (version) => {
      vi.mocked(resolveLatestVersionFromPackage).mockReturnValue(version);
      const report = await resolvePluginVersionDriftTargets(clawhubDriftReport(version));
      const entry = expectDefined(report.drifts[0], "installed Seedbank version");
      expect(entry.targetResolution).toMatchObject({ status: "registry-current", version });
      expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
    },
  );

  it("targets the newest Seedbank version rather than the host version", async () => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(clawhubDriftReport("2026.9.2"));
    const entry = expectDefined(report.drifts[0], "clawhub plugin drift");
    expect(entry.targetResolution).toEqual({
      status: "resolved",
      packageName: "@branch/whatsapp",
      requestedTarget: "2026.9.4",
      version: "2026.9.3",
    });
    expect(resolvePluginVersionDriftUpdateCommand(entry)).toBe("branch plugins update whatsapp");
  });

  it.each([
    { spec: "clawhub:@branch/slack", clawhubPackage: "@branch/slack" },
    { spec: "clawhub:@branch/slack", clawhubPackage: undefined },
    { spec: undefined, clawhubPackage: "@branch/slack" },
  ])("resolves npm-only catalog entries from recorded Seedbank identity: %j", async (identity) => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(
      detectPluginVersionDrift({
        gatewayVersion: "2026.9.4",
        installRecords: {
          slack: clawhubRecord("2026.9.3", {
            ...identity,
            clawhubChannel: "official",
            clawhubUrl: "https://clawhub.ai",
          }),
        },
      }),
    );
    expect(fetchClawHubPackageDetail).toHaveBeenCalledWith({
      name: "@branch/slack",
      baseUrl: "https://clawhub.ai",
    });
    const entry = expectDefined(report.drifts[0], "npm-only catalog Seedbank install");
    expect(entry.targetResolution).toMatchObject({
      status: "registry-current",
      packageName: "@branch/slack",
      version: "2026.9.3",
    });
  });

  it.each([
    { clawhubUrl: "https://registry.example.test" },
    { clawhubChannel: "community" },
    { resolvedName: "@vendor/slack" },
    { clawhubPackage: "@vendor/slack" },
    { spec: undefined, clawhubPackage: undefined, resolvedSpec: "clawhub:@branch/slack" },
  ] satisfies Partial<PluginInstallRecord>[])(
    "does not resolve untrusted or mismatched Seedbank identities: %j",
    async (overrides) => {
      const report = await resolvePluginVersionDriftTargets(
        detectPluginVersionDrift({
          gatewayVersion: "2026.9.4",
          installRecords: {
            slack: clawhubRecord("2026.9.3", {
              spec: "clawhub:@branch/slack",
              clawhubPackage: "@branch/slack",
              clawhubChannel: "official",
              clawhubUrl: "https://clawhub.ai",
              ...overrides,
            }),
          },
        }),
      );
      expect(report.drifts).toEqual([]);
      expect(fetchClawHubPackageDetail).not.toHaveBeenCalled();
    },
  );

  it("uses the recorded registry even when the environment selects a different registry", async () => {
    vi.stubEnv("BRANCH_CLAWHUB_URL", "https://alternate.example.test");
    try {
      vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
      const report = await resolvePluginVersionDriftTargets(
        detectPluginVersionDrift({
          gatewayVersion: "2026.9.4",
          installRecords: {
            whatsapp: clawhubRecord("2026.9.3", {
              clawhubUrl: "https://clawhub.ai",
              clawhubChannel: "official",
            }),
          },
        }),
      );
      expect(fetchClawHubPackageDetail).toHaveBeenCalledWith({
        name: "@branch/whatsapp",
        baseUrl: "https://clawhub.ai",
      });
      expect(report.drifts[0]?.targetResolution?.status).toBe("registry-current");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prescribes a stale-pin repair accepted by the current selector and update owner", async () => {
    const installRecords: Record<string, PluginInstallRecord> = {
      whatsapp: clawhubRecord("2026.9.2", { spec: "clawhub:@branch/whatsapp@2026.9.2" }),
    };
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(
      detectPluginVersionDrift({
        gatewayVersion: "2026.9.4",
        config: { update: { channel: "stable" } },
        installRecords,
      }),
    );
    // An update resumes the catalog's unpinned policy for a pin at or below the
    // target Gateway, so the diagnostic resolves the same target it would install.
    expect(fetchClawHubPackageDetail).toHaveBeenCalledWith({
      name: "@branch/whatsapp",
      baseUrl: "https://clawhub.ai",
    });
    const entry = expectDefined(report.drifts[0], "stale Seedbank pin");
    expect(entry.targetResolution).toEqual({
      status: "resolved",
      packageName: "@branch/whatsapp",
      requestedTarget: "2026.9.4",
      version: "2026.9.3",
    });
    const command = resolvePluginVersionDriftUpdateCommand(entry);
    expect(command).toBe("branch plugins update whatsapp");
    const rawId = expectDefined(command, "repair command").replace("branch plugins update ", "");
    // Consume the emitted argument through the current CLI owner. An accompanying
    // package-owned alias must deduplicate to the same installed record.
    const selectorInput = {
      installs: installRecords,
      rawIds: [rawId, "whatsapp-alias"],
      installOwnerByPluginId: new Map([["whatsapp-alias", "whatsapp"]]),
    };
    const selection = resolvePluginUpdateSelection(selectorInput);
    expect(selection).toEqual({ pluginIds: ["whatsapp"] });
    const selectedId = expectDefined(selection.pluginIds[0], "selected install owner");
    const record = expectDefined(installRecords[selectedId], "selected install record");
    expect(
      resolveClawHubUpdateSpecs({
        record,
        officialSpec: entry.clawhubOfficialSpec,
        updateChannel: entry.clawhubUpdateChannel,
        officialPackageName: entry.clawhubPackage,
        coreVersion: entry.gatewayVersion,
      }).installSpec,
    ).toBe("clawhub:@branch/whatsapp");
    // The diagnostic is guidance, not admission: current rejected owner and alias
    // facts still stop the actual selection without rewriting source trust.
    for (const rejectedId of ["whatsapp", "whatsapp-alias"]) {
      expect(
        resolvePluginUpdateSelection({
          ...selectorInput,
          rejectedPluginIds: new Map([[rejectedId, "fixture ownership rejection"]]),
        }),
      ).toEqual({ pluginIds: [], error: "fixture ownership rejection" });
    }
  });

  it("keeps a recorded pin above the target Gateway unresolved", async () => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(
      detectPluginVersionDrift({
        gatewayVersion: "2026.9.4",
        config: { update: { channel: "stable" } },
        installRecords: {
          whatsapp: clawhubRecord("2026.9.5", { spec: "clawhub:@branch/whatsapp@2026.9.5" }),
        },
      }),
    );
    const entry = expectDefined(report.drifts[0], "ahead-of-Gateway Seedbank pin");
    expect(entry.targetResolution?.status).toBe("unresolved");
    expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
    expect(fetchClawHubPackageDetail).not.toHaveBeenCalled();
  });

  it.each([
    { spec: "clawhub:@branch/whatsapp@beta", channel: "stable" as const },
    { spec: "clawhub:@branch/whatsapp", channel: "beta" as const },
    { spec: "clawhub:@branch/whatsapp@latest", channel: "extended-stable" as const },
  ])(
    "does not replace selected target with latest: $spec / $channel",
    async ({ spec, channel }) => {
      vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
      const report = await resolvePluginVersionDriftTargets(
        detectPluginVersionDrift({
          gatewayVersion: "2026.9.4",
          config: { update: { channel } },
          installRecords: { whatsapp: clawhubRecord("2026.9.3", { spec }) },
        }),
      );
      const entry = expectDefined(report.drifts[0], "non-latest Seedbank target");
      expect(entry.targetResolution?.status).toBe("unresolved");
      expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
      expect(fetchClawHubPackageDetail).not.toHaveBeenCalled();
    },
  );

  it("uses the installed beta channel when none is configured", async () => {
    vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
    const report = await resolvePluginVersionDriftTargets(
      clawhubDriftReport("2026.9.3", "2026.9.4-beta.1"),
    );
    expect(report.drifts[0]?.targetResolution?.status).toBe("unresolved");
    expect(fetchClawHubPackageDetail).not.toHaveBeenCalled();
  });

  it.each([{ pluginApiRange: ">=2026.10.1" }, { minGatewayVersion: "2026.10.1" }])(
    "keeps incompatible latest installs visible: %j",
    async (compatibility) => {
      vi.mocked(resolveLatestVersionFromPackage).mockReturnValue("2026.9.3");
      vi.mocked(fetchClawHubPackageDetail).mockResolvedValue({
        package: {
          name: "@branch/whatsapp",
          displayName: "WhatsApp",
          family: "code-plugin",
          channel: "official",
          isOfficial: true,
          createdAt: 0,
          updatedAt: 0,
          compatibility,
        },
      });
      const report = await resolvePluginVersionDriftTargets(clawhubDriftReport("2026.9.3"));
      const entry = expectDefined(report.drifts[0], "incompatible Seedbank install");
      expect(entry.targetResolution).toMatchObject({
        status: "unresolved",
        error: expect.stringContaining("2026.10.1"),
      });
      expect(resolvePluginVersionDriftUpdateCommand(entry)).toBeUndefined();
    },
  );

  it.each([
    {
      label: "lookup fails",
      arrange: () => vi.mocked(fetchClawHubPackageDetail).mockRejectedValue(new Error("HTTP 503")),
      error: "HTTP 503",
    },
    {
      label: "no latest version is published",
      arrange: () => vi.mocked(resolveLatestVersionFromPackage).mockReturnValue(null),
      error: "no latest version",
    },
  ])("keeps drift reported when $label", async ({ arrange, error }) => {
    arrange();
    const report = await resolvePluginVersionDriftTargets(clawhubDriftReport("2026.9.3"));
    const entry = expectDefined(report.drifts[0], "clawhub plugin drift");
    expect(entry.targetResolution).toMatchObject({
      status: "unresolved",
      packageName: "@branch/whatsapp",
      requestedTarget: "2026.9.4",
      error: expect.stringContaining(error),
    });
  });
});

describe("resolvePluginVersionDriftUpdateCommand", () => {
  it("prefers the parsed exact npm spec package over inconsistent drift metadata", () => {
    expect(
      resolvePluginVersionDriftUpdateCommand({
        pluginId: "brave",
        installedVersion: "2026.6.9",
        gatewayVersion: "2026.6.10-beta.1",
        source: "npm",
        packageName: "@branch/other-plugin",
        spec: "@branch/brave-plugin@2026.6.9",
        ...resolvedNpmTarget("@branch/brave-plugin", "2026.6.10-beta.1"),
      }),
    ).toBe("branch plugins update @branch/brave-plugin@2026.6.10-beta.1");
  });

  it.each([
    {
      pluginId: "codex",
      source: "npm" as const,
      packageName: "@branch/codex",
      spec: "@branch/codex",
    },
    {
      pluginId: "diagnostics-otel",
      source: "clawhub" as const,
      packageName: "@branch/diagnostics-otel",
      spec: "clawhub:@branch/diagnostics-otel",
    },
  ])("keeps the repairing plugin-id update for a floating $source install", (entry) => {
    expect(
      resolvePluginVersionDriftUpdateCommand({
        pluginId: entry.pluginId,
        installedVersion: "2026.6.9",
        gatewayVersion: "2026.6.10-beta.1",
        source: entry.source,
        packageName: entry.packageName,
        spec: entry.spec,
      }),
    ).toBe(`branch plugins update ${entry.pluginId}`);
  });

  it("does not fabricate a command when an exact npm target was not resolved", () => {
    expect(
      resolvePluginVersionDriftUpdateCommand({
        pluginId: "brave",
        installedVersion: "2026.6.9",
        gatewayVersion: "unknown",
        source: "npm",
        packageName: "@branch/brave-plugin",
        spec: "@branch/brave-plugin@2026.6.9",
      }),
    ).toBeUndefined();
  });
});
