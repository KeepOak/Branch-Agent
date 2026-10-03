import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfigPathCandidate } from "./config.js";
import { withTempHome } from "./test-helpers.js";

describe("Nix integration config selection", () => {
  it("defaults CONFIG_PATH to BRANCH_HOME/.branch/branch.json", () => {
    const customHome = path.join(path.sep, "custom", "home");
    expect(resolveConfigPathCandidate({ BRANCH_HOME: customHome })).toBe(
      path.join(path.resolve(customHome), ".branch", "branch.json"),
    );
  });

  it("expands ~ in BRANCH_CONFIG_PATH override", async () => {
    await withTempHome(async (home) => {
      expect(
        resolveConfigPathCandidate(
          { BRANCH_HOME: home, BRANCH_CONFIG_PATH: "~/.branch/custom.json" },
          () => home,
        ),
      ).toBe(path.join(home, ".branch", "custom.json"));
    });
  });

  it("uses STATE_DIR when only state dir is overridden", () => {
    expect(
      resolveConfigPathCandidate(
        { BRANCH_STATE_DIR: "/custom/state", BRANCH_TEST_FAST: "1" },
        () => path.join(path.sep, "tmp", "branch-config-home"),
      ),
    ).toBe(path.join(path.resolve("/custom/state"), "branch.json"));
  });
});
