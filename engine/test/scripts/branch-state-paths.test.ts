import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveBranchConfigPath as resolveConfig,
  resolveBranchStateDir as resolveState,
} from "../../scripts/e2e/lib/branch-state-paths.mjs";
import { withEnv } from "../../src/test-utils/env.js";

const home = path.join(path.sep, "tmp", "branch-home");
const state = path.join(path.sep, "tmp", "branch-state");
const rawState = `${state}/../raw `;
const rawConfig = " ./raw config.json ";

describe("Branch Agent E2E state paths", () => {
  it.each([
    ["returns raw state path bytes", resolveState, [home, undefined, rawState], rawState],
    ["preserves whitespace state overrides", resolveState, [home, undefined, " \t "], " \t "],
    [
      "falls back from an empty state override",
      resolveState,
      [home, undefined, ""],
      path.join(home, ".branch"),
    ],
    [
      "returns a config override without resolving HOME",
      resolveConfig,
      [undefined, rawConfig, undefined],
      rawConfig,
    ],
    [
      "falls back from an empty config override via state",
      resolveConfig,
      [undefined, "", state],
      path.join(state, "branch.json"),
    ],
  ])("%s", (_name, resolve, [HOME, BRANCH_CONFIG_PATH, BRANCH_STATE_DIR], expected) => {
    withEnv({ HOME, BRANCH_CONFIG_PATH, BRANCH_STATE_DIR }, () =>
      expect(resolve()).toBe(expected),
    );
  });

  it.each([
    ["state", resolveState],
    ["config", resolveConfig],
  ])("rejects missing HOME for the default %s path", (_name, resolve) => {
    withEnv(
      { HOME: undefined, BRANCH_CONFIG_PATH: undefined, BRANCH_STATE_DIR: undefined },
      () => expect(resolve).toThrow(TypeError),
    );
  });
});
