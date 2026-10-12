// Tests npm registry spec parsing for packages, tags, and versions.
import { describe, expect, it } from "vitest";
import {
  compareBranchReleaseVersions,
  formatPrereleaseResolutionError,
  isExactSemverVersion,
  isPrereleaseSemverVersion,
  isPrereleaseResolutionAllowed,
  parseRegistryNpmSpec,
  resolveBranchReleaseCohortVersion,
  resolveNpmJsonEntries,
  validateRegistryNpmSpec,
} from "./npm-registry-spec.js";

function parseSpecOrThrow(spec: string) {
  const parsed = parseRegistryNpmSpec(spec);
  if (parsed === null) {
    throw new Error(`Expected ${spec} to parse`);
  }
  return parsed;
}

describe("npm registry spec validation", () => {
  it.each(["@branch/voice-call@1.2.3"])("accepts %s", (spec) => {
    expect(validateRegistryNpmSpec(spec)).toBeNull();
  });

  it.each([
    ["@branch/voice-call@^1.2.3", "exact version or dist-tag"],
    ["https://npmjs.org/pkg.tgz", "URLs are not allowed"],
    ["@branch/voice-call@", "missing version/tag after @"],
    ["@branch/voice-call@../beta", "invalid version/tag"],
  ])("rejects %s", (spec, expected) => {
    expect(validateRegistryNpmSpec(spec)).toContain(expected);
  });
});

describe("npm registry spec parsing helpers", () => {
  it.each([
    [
      "@branch/voice-call",
      {
        name: "@branch/voice-call",
        raw: "@branch/voice-call",
        selectorKind: "none",
        selectorIsPrerelease: false,
      },
    ],
    [
      "@branch/voice-call@beta",
      {
        name: "@branch/voice-call",
        raw: "@branch/voice-call@beta",
        selector: "beta",
        selectorKind: "tag",
        selectorIsPrerelease: false,
      },
    ],
    [
      "@branch/voice-call@2026.5.3-1",
      {
        name: "@branch/voice-call",
        raw: "@branch/voice-call@2026.5.3-1",
        selector: "2026.5.3-1",
        selectorKind: "exact-version",
        selectorIsPrerelease: false,
      },
    ],
    [
      "@branch/voice-call@1.2.3-beta.1",
      {
        name: "@branch/voice-call",
        raw: "@branch/voice-call@1.2.3-beta.1",
        selector: "1.2.3-beta.1",
        selectorKind: "exact-version",
        selectorIsPrerelease: true,
      },
    ],
  ])("parses %s", (spec, expected) => {
    expect(parseRegistryNpmSpec(spec)).toEqual(expected);
  });

  it.each([
    ["v1.2.3", true],
    ["1.2", false],
  ])("detects exact semver versions for %s", (value, expected) => {
    expect(isExactSemverVersion(value)).toBe(expected);
  });

  it.each([
    ["1.2.3-beta.1", true],
    ["1.2.3-1", true],
    ["2026.5.3-beta.1", true],
    ["2026.5.3-1", false],
    ["2026.2.30-1", false],
    ["1.2.3", false],
  ])("detects prerelease semver versions for %s", (value, expected) => {
    expect(isPrereleaseSemverVersion(value)).toBe(expected);
  });

  it.each([
    ["2026.5.3-1", "2026.5.3", 1],
    ["2026.5.3-2", "2026.5.3-1", 1],
    ["2026.5.3", "2026.5.3-beta.3", 1],
    ["2026.5.3-beta.3", "2026.5.3-alpha.9", 1],
    ["2026.5.3-alpha.10", "2026.5.3-alpha.2", 1],
    ["2026.5.3-0", "2026.5.3", null],
    ["2026.5.3+build", "2026.5.3", null],
    ["1.2.3-1", "1.2.3", null],
  ])("compares Branch Agent release versions for %s and %s", (left, right, expected) => {
    expect(compareBranchReleaseVersions(left, right)).toBe(expected);
  });

  it.each([
    [" 2026.7.1-1 ", "2026.7.1"],
    ["2026.7.1", "2026.7.1"],
    ["2026.7.1-beta.3", "2026.7.1-beta.3"],
    ["1.2.3-1", "1.2.3-1"],
  ])("resolves the Branch Agent release cohort for %s", (version, expected) => {
    expect(resolveBranchReleaseCohortVersion(version)).toBe(expected);
  });
});

describe("npm prerelease resolution policy", () => {
  it.each([
    ["@branch/voice-call", "1.2.3-beta.1", false],
    ["@branch/voice-call@latest", "1.2.3-rc.1", false],
    ["@branch/voice-call@latest", "2026.5.3-1", true],
    ["@branch/voice-call@beta", "1.2.3-beta.4", true],
    ["@branch/voice-call@1.2.3-beta.1", "1.2.3-beta.1", true],
    ["@branch/voice-call", "1.2.3", true],
    ["@branch/voice-call@latest", undefined, true],
  ])("decides prerelease resolution for %s -> %s", (spec, resolvedVersion, expected) => {
    expect(
      isPrereleaseResolutionAllowed({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toBe(expected);
  });

  it.each([
    ["@branch/voice-call", "1.2.3-beta.1", `Use "@branch/voice-call@beta"`],
    [
      "@branch/voice-call@beta",
      "1.2.3-rc.1",
      "Use an explicit prerelease tag or exact prerelease version",
    ],
  ])("formats prerelease guidance for %s", (spec, resolvedVersion, expected) => {
    expect(
      formatPrereleaseResolutionError({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toContain(expected);
  });
});

describe("resolveNpmJsonEntries", () => {
  it("passes entry arrays through (npm <=11 pack shape)", () => {
    const entries = [{ name: "branch", version: "2026.7.1", filename: "branch-2026.7.1.tgz" }];
    expect(resolveNpmJsonEntries(entries)).toBe(entries);
  });

  it("keeps a bare entry object as a single entry (npm <=11 view shape)", () => {
    const entry = { name: "branch", version: "2026.7.1", "dist.integrity": "sha512-x" };
    expect(resolveNpmJsonEntries(entry)).toEqual([entry]);
  });

  it("unwraps scoped name keys in the npm 12 pack object", () => {
    const entry = { id: "@branch/voice-call@1.2.3", name: "@branch/voice-call" };
    expect(resolveNpmJsonEntries({ "@branch/voice-call": entry })).toEqual([entry]);
  });

  it("falls back to the raw value when no entries are recognizable", () => {
    expect(resolveNpmJsonEntries("not-json-shaped")).toEqual(["not-json-shaped"]);
    expect(resolveNpmJsonEntries(null)).toEqual([null]);
  });
});
