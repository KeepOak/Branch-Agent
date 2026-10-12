// Tests Branch Agent execution environment construction.
import { describe, expect, it } from "vitest";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import {
  ensureBranchExecMarkerOnProcess,
  markBranchExecEnv,
  BRANCH_CLI_ENV_VAR,
} from "./branch-exec-env.js";

const BRANCH_CLI_ENV_VALUE = "1";

describe("markBranchExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", BRANCH_CLI: "0" };
    const marked = markBranchExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      BRANCH_CLI: BRANCH_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.BRANCH_CLI).toBe("0");
  });
});

describe("ensureBranchExecMarkerOnProcess", () => {
  it("overwrites an existing marker on the provided process env", () => {
    const env = { PATH: "/usr/bin", [BRANCH_CLI_ENV_VAR]: "0" };
    expect(ensureBranchExecMarkerOnProcess(env)).toBe(env);
    expect(env[BRANCH_CLI_ENV_VAR]).toBe(BRANCH_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[BRANCH_CLI_ENV_VAR];
    deleteTestEnvValue(BRANCH_CLI_ENV_VAR);

    try {
      expect(ensureBranchExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[BRANCH_CLI_ENV_VAR]).toBe(BRANCH_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        deleteTestEnvValue(BRANCH_CLI_ENV_VAR);
      } else {
        setTestEnvValue(BRANCH_CLI_ENV_VAR, previous);
      }
    }
  });
});
