import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNpmSpecMetadata } from "../infra/install-source-utils.js";
import { resolveNpmIntegrityDriftWithDefaultMessage } from "../infra/npm-integrity.js";
import {
  installWithSourceFallback,
  resolveClawHubInstallSpecsForUpdateChannel,
  resolveNpmInstallSpecsForUpdateChannel,
} from "./install-channel-specs.js";

vi.mock("../infra/install-source-utils.js", () => ({ resolveNpmSpecMetadata: vi.fn() }));

beforeEach(() => {
  vi.mocked(resolveNpmSpecMetadata).mockReset();
});

describe("installWithSourceFallback", () => {
  it.each(["notarget", "etarget"])(
    "keeps an integrity refusal terminal for package %s",
    async (name) => {
      const spec = `@synthetic/${name}@1.0.0`;
      const refusal = await resolveNpmIntegrityDriftWithDefaultMessage({
        spec,
        expectedIntegrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
        resolution: {
          resolvedSpec: spec,
          integrity: `sha512-${Buffer.alloc(64, 2).toString("base64")}`,
        },
        onIntegrityDrift: () => false,
      });
      expect(refusal.error).toContain("aborted: npm package integrity drift");
      const attempted: string[] = [];
      const result = await installWithSourceFallback({
        sources: [
          { source: "npm", spec },
          { source: "clawhub", spec: `clawhub:${name}@1.0.0` },
        ],
        install: async ({ source }) => {
          attempted.push(source);
          return source === "npm" ? { ok: false, error: refusal.error } : { ok: true };
        },
        result: (attempt) => attempt,
        onFallback: () => {},
      });
      expect(result.attempt).toEqual({ ok: false, error: refusal.error });
      expect(attempted).toEqual(["npm"]);
    },
  );
});

describe("resolveNpmInstallSpecsForUpdateChannel", () => {
  it.each([
    {
      channel: "extended-stable" as const,
      versionBoundToCore: false,
      coreVersion: "2026.7.33",
      expectedVersion: "2026.7.33",
    },
    {
      channel: "stable" as const,
      versionBoundToCore: true,
      coreVersion: "2026.8.1",
      expectedVersion: "2026.8.1",
    },
    {
      channel: "stable" as const,
      versionBoundToCore: true,
      coreVersion: "2026.7.1-2",
      expectedVersion: "2026.7.1",
    },
    {
      channel: "extended-stable" as const,
      versionBoundToCore: true,
      coreVersion: "2026.7.1-2",
      expectedVersion: "2026.7.1",
    },
  ])(
    "preserves the $channel release-cohort contract for $coreVersion",
    async ({ channel, versionBoundToCore, coreVersion, expectedVersion }) => {
      for (const spec of ["@branch/codex", "@branch/codex@latest"]) {
        expect(
          await resolveNpmInstallSpecsForUpdateChannel({
            spec,
            updateChannel: channel,
            officialPackageName: "@branch/codex",
            coreVersion,
            versionBoundToCore,
          }),
        ).toEqual({ installSpec: `@branch/codex@${expectedVersion}`, recordSpec: spec });
      }
      expect(resolveNpmSpecMetadata).not.toHaveBeenCalled();
    },
  );

  it.each(["2026.6.33", "next", "^2026.6.0"])(
    "preserves an explicit selector %s on beta",
    async (selector) => {
      const spec = `@branch/codex@${selector}`;
      expect(
        await resolveNpmInstallSpecsForUpdateChannel({
          spec,
          updateChannel: "beta",
          officialPackageName: "@branch/codex",
          coreVersion: "2026.8.1-beta.3",
        }),
      ).toEqual({ installSpec: spec, recordSpec: spec });
      expect(resolveNpmSpecMetadata).not.toHaveBeenCalled();
    },
  );

  it.each(["stable", "extended-stable"] as const)(
    "preserves explicit beta on %s",
    async (updateChannel) => {
      const spec = "@branch/codex@beta";
      expect(
        await resolveNpmInstallSpecsForUpdateChannel({
          spec,
          updateChannel,
          officialPackageName: "@branch/codex",
          coreVersion: "2026.8.1-beta.3",
        }),
      ).toEqual({ installSpec: spec, recordSpec: spec });
    },
  );

  it("does not rewrite a third-party extended-stable package", async () => {
    expect(
      await resolveNpmInstallSpecsForUpdateChannel({
        spec: "@acme/discord",
        updateChannel: "extended-stable",
        officialPackageName: "@branch/discord",
        coreVersion: "2026.7.33",
      }),
    ).toEqual({ installSpec: "@acme/discord", recordSpec: "@acme/discord" });
  });

  it("fails closed without an authoritative extended-stable core version", async () => {
    await expect(
      resolveNpmInstallSpecsForUpdateChannel({
        spec: "@branch/codex",
        updateChannel: "extended-stable",
        officialPackageName: "@branch/codex",
      }),
    ).rejects.toThrow("requires an exact core version");
  });

  it.each([
    {
      beta: "2026.9.1-beta.1",
      latest: "2026.9.2",
      expected: "2026.9.2",
      tag: "latest",
      reason: "tag-behind-latest",
    },
    { beta: "2026.9.3-beta.1", latest: "2026.9.2", expected: "2026.9.3-beta.1", tag: "beta" },
    { beta: "2026.9.2", latest: "2026.9.2", expected: "2026.9.2", tag: "beta" },
    { beta: null, latest: "2026.9.2", expected: "2026.9.2", tag: "latest" },
    { beta: "2026.9.3-beta.1", latest: null, expected: "2026.9.3-beta.1", tag: "beta" },
  ])(
    "selects $expected from beta=$beta latest=$latest before installation",
    async ({ beta, latest, expected, tag, reason }) => {
      vi.mocked(resolveNpmSpecMetadata).mockImplementation(async ({ spec }) => {
        const version = spec.endsWith("@beta") ? beta : latest;
        return version
          ? {
              ok: true,
              metadata: {
                name: "@branch/codex",
                version,
                resolvedSpec: `@branch/codex@${version}`,
                integrity: `sha512-${version}`,
              },
            }
          : { ok: false, error: "Package not found on npm" };
      });
      for (const spec of ["@branch/codex", "@branch/codex@latest", "@branch/codex@beta"]) {
        const result = await resolveNpmInstallSpecsForUpdateChannel({
          spec,
          updateChannel: "beta",
          officialPackageName: "@branch/codex",
          coreVersion: "2026.9.1-beta.1",
          versionBoundToCore: true,
        });
        expect(result).toEqual({
          installSpec: `@branch/codex@${expected}`,
          recordSpec: spec,
          npmResolution: {
            name: "@branch/codex",
            version: expected,
            resolvedSpec: `@branch/codex@${expected}`,
            integrity: `sha512-${expected}`,
          },
          channelTag: tag,
          ...(reason ? { channelReason: reason } : {}),
        });
      }
    },
  );

  it("leaves missing packages to the install owner's declared-source fallback", async () => {
    vi.mocked(resolveNpmSpecMetadata).mockResolvedValue({
      ok: false,
      error: "Package not found on npm",
    });
    expect(
      await resolveNpmInstallSpecsForUpdateChannel({
        spec: "@branch/codex@beta",
        updateChannel: "beta",
      }),
    ).toEqual({ installSpec: "@branch/codex@latest", recordSpec: "@branch/codex@beta" });
  });

  it.each(["beta", "latest"] as const)(
    "does not install the other tag when %s metadata fails",
    async (failedTag) => {
      vi.mocked(resolveNpmSpecMetadata).mockImplementation(async ({ spec }) =>
        spec.endsWith(`@${failedTag}`)
          ? { ok: false, category: "metadata-env", error: "Registry unavailable" }
          : { ok: true, metadata: { name: "@branch/codex", version: "2026.9.1-beta.1" } },
      );
      await expect(
        resolveNpmInstallSpecsForUpdateChannel({ spec: "@branch/codex", updateChannel: "beta" }),
      ).rejects.toThrow("Registry unavailable");
    },
  );
});

describe("resolveClawHubInstallSpecsForUpdateChannel", () => {
  it.each([
    ["stable", false, "2026.7.33", undefined],
    ["stable", true, "2026.7.33", "2026.7.33"],
    ["beta", false, "2026.8.1-beta.3", "beta"],
    ["extended-stable", false, "2026.7.33", "2026.7.33"],
  ] as const)(
    "resolves declared Seedbank defaults on %s (bound: %s, core: %s)",
    (updateChannel, versionBoundToCore, coreVersion, selector) => {
      for (const spec of ["clawhub:@branch/discord", "clawhub:@branch/discord@latest"]) {
        const installSpec = selector ? `clawhub:@branch/discord@${selector}` : spec;
        expect(
          resolveClawHubInstallSpecsForUpdateChannel({
            spec,
            updateChannel,
            officialPackageName: "@branch/discord",
            coreVersion,
            versionBoundToCore,
          }),
        ).toEqual({
          installSpec,
          recordSpec: spec,
          ...(updateChannel === "beta" ? { fallbackSpec: spec, fallbackLabel: installSpec } : {}),
        });
      }
    },
  );

  it.each(["stable", "beta", "extended-stable"] as const)(
    "preserves exact and non-latest Seedbank selectors on %s",
    (updateChannel) => {
      for (const selector of ["2026.6.33", "next", "beta"]) {
        const spec = `clawhub:@branch/discord@${selector}`;
        expect(
          resolveClawHubInstallSpecsForUpdateChannel({
            spec,
            updateChannel,
            officialPackageName: "@branch/discord",
            coreVersion: updateChannel === "beta" ? "2026.8.1-beta.3" : "2026.7.33",
            versionBoundToCore: true,
          }),
        ).toEqual({ installSpec: spec, recordSpec: spec });
      }
    },
  );

  it("does not rewrite Seedbank on extended-stable", () => {
    expect(
      resolveClawHubInstallSpecsForUpdateChannel({
        spec: "clawhub:@branch/discord",
        updateChannel: "extended-stable",
      }),
    ).toEqual({
      installSpec: "clawhub:@branch/discord",
      recordSpec: "clawhub:@branch/discord",
    });
  });
});
