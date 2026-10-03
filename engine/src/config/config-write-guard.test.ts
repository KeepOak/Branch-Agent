import { describe, expect, it } from "vitest";
import {
  assertConfigWriteAllowedInCurrentMode,
  ConfigReadOnlyError,
  NixModeConfigMutationError,
} from "./config-write-guard.js";

describe("config write policy", () => {
  it.each([undefined, "true"])("leaves writes enabled for BRANCH_CONFIG_READONLY=%s", (value) => {
    expect(() =>
      assertConfigWriteAllowedInCurrentMode({ env: { BRANCH_CONFIG_READONLY: value } }),
    ).not.toThrow();
  });

  it("reports external management without Nix guidance", () => {
    const run = () =>
      assertConfigWriteAllowedInCurrentMode({
        env: { BRANCH_CONFIG_READONLY: "1" },
        configPath: "/managed/branch.json",
      });
    expect(run).toThrow(ConfigReadOnlyError);
    expect(run).toThrow("external deployment source");
    expect(run).toThrow("/managed/branch.json");
    expect(run).not.toThrow(/Nix|nix-branch/);
  });

  it.each([undefined, "1"])(
    "preserves Nix policy and guidance with BRANCH_CONFIG_READONLY=%s",
    (value) => {
      expect(() =>
        assertConfigWriteAllowedInCurrentMode({
          env: { BRANCH_NIX_MODE: "1", BRANCH_CONFIG_READONLY: value },
        }),
      ).toThrow(NixModeConfigMutationError);
    },
  );
});
