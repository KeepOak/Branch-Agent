import { describe, expect, it } from "vitest";
import {
  branchNpmPrepublishVerifyUsage,
  parseBranchNpmPrepublishVerifyArgs,
  usesPreparedLocalDependencyInstall,
} from "../scripts/branch-npm-prepublish-verify.ts";

describe("parseBranchNpmPrepublishVerifyArgs", () => {
  it("supports help, optional versions, and package-manager separators", () => {
    expect(parseBranchNpmPrepublishVerifyArgs(["--help"])).toEqual({
      dependencyTarballPaths: [],
      help: true,
      tarballPath: "",
    });
    expect(parseBranchNpmPrepublishVerifyArgs(["branch.tgz"])).toEqual({
      dependencyTarballPaths: [],
      help: false,
      tarballPath: "branch.tgz",
    });
    expect(parseBranchNpmPrepublishVerifyArgs(["--", "branch.tgz", "2026.3.23"])).toEqual({
      dependencyTarballPaths: [],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "branch.tgz",
    });
  });

  it("rejects missing, option-like, and extra arguments before installing", () => {
    expect(() => parseBranchNpmPrepublishVerifyArgs([])).toThrow(
      branchNpmPrepublishVerifyUsage(),
    );
    expect(() => parseBranchNpmPrepublishVerifyArgs(["--tag"])).toThrow(
      "Unknown branch npm prepublish verifier option: --tag",
    );
    expect(() => parseBranchNpmPrepublishVerifyArgs(["branch.tgz", "--tag"])).toThrow(
      "Unknown branch npm prepublish verifier option: --tag",
    );
    expect(
      parseBranchNpmPrepublishVerifyArgs(["branch.tgz", "2026.3.23", "llm-core.tgz", "ai.tgz"]),
    ).toEqual({
      dependencyTarballPaths: ["llm-core.tgz", "ai.tgz"],
      expectedVersion: "2026.3.23",
      help: false,
      tarballPath: "branch.tgz",
    });
    expect(() =>
      parseBranchNpmPrepublishVerifyArgs(["branch.tgz", "2026.3.23", "--bad"]),
    ).toThrow("Invalid dependency tarball path: --bad");
  });
});

describe("usesPreparedLocalDependencyInstall", () => {
  it("uses the prepared local project only for the single AI tarball release path", () => {
    expect(usesPreparedLocalDependencyInstall(0)).toBe(false);
    expect(usesPreparedLocalDependencyInstall(1)).toBe(true);
    expect(usesPreparedLocalDependencyInstall(2)).toBe(false);
  });
});
