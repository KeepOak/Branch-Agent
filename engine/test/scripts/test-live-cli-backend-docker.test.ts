import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createScriptTestHarness } from "./test-helpers.js";
const SCRIPT_PATH = path.resolve("scripts/test-live-cli-backend-docker.sh");
const { createTempDir } = createScriptTestHarness();
it("validates setup early and forwards argument overrides into Docker", () => {
  const invalid = spawnSync("/bin/bash", [SCRIPT_PATH], {
    encoding: "utf8",
    env: { ...process.env, BRANCH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS: "180s" },
  });
  expect(invalid.status).toBe(2);
  expect(invalid.stderr).toContain("invalid BRANCH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS: 180s");
  expect(invalid.stderr).not.toMatch(/Cannot find package 'tsx'|docker/);
  const root = createTempDir("branch-live-cli-capture-");
  const controls = [
    "BRANCH_LIVE_CLI_BACKEND_ARGS",
    "BRANCH_LIVE_CLI_BACKEND_RESUME_ARGS",
    "BRANCH_TEST_CONSOLE",
    "BRANCH_LIVE_CLI_BACKEND_CACHE_PROBE",
    "BRANCH_LIVE_CLI_BACKEND_ADVISORY",
    "BRANCH_LIVE_CLI_BACKEND_ALLOW_PROVIDER_SKIP",
  ];
  for (const dir of ["scripts", "bin", "home"]) {
    mkdirSync(path.join(root, dir));
  }
  symlinkSync(path.resolve("scripts/lib"), path.join(root, "scripts/lib"));
  for (const target of "scripts/test-live-build-docker.sh bin/docker bin/node bin/timeout".split(
    " ",
  )) {
    symlinkSync("/usr/bin/true", path.join(root, target));
  }
  const result = spawnSync("/bin/bash", ["-x", SCRIPT_PATH], {
    encoding: "utf8",
    env: {
      HOME: path.join(root, "home"),
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      BRANCH_LIVE_DOCKER_TRUSTED_HARNESS_DIR: root,
      ...Object.fromEntries(controls.map((key) => [key, "forwarded"])),
    },
  });
  expect(result.status).toBe(0);
  for (const key of controls) {
    expect(result.stderr).toContain(`${key}=forwarded`);
  }
});
