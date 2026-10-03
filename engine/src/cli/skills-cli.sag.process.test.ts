import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureLifetime } from "../../test/helpers/fixture-lifetime.js";
import {
  createBuiltRuntime,
  createSourceRuntime,
  runBuiltRuntime,
  runSourceRuntime,
} from "../commands/doctor-config-preflight.process.test-support.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { getFreePort } from "../test-utils/ports.js";
import { cliRecoveryEntrypoints } from "./cli-entrypoint.test-support.js";

const tempDirs = createFixtureLifetime();
afterEach(() => tempDirs.cleanup());

async function createSagCliFixture(enabled?: boolean) {
  const root = tempDirs.createTempDir("branch-sag-cli-");
  const configPath = path.join(root, "branch.json");
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir);
  // Readiness checks executable access; credentials are resolved only when sag runs.
  fs.writeFileSync(path.join(binDir, process.platform === "win32" ? "sag.cmd" : "sag"), "", {
    mode: 0o755,
  });
  const config = {
    gateway: {
      mode: "local",
      port: await getFreePort(),
      auth: { mode: "token", token: "sag-fixture-token" },
    },
    agents: {
      ownership: "explicit",
      entries: { main: { workspace: path.join(root, "workspace") } },
    },
    skills: {
      allowBundled: ["sag"],
      ...(enabled === undefined ? {} : { entries: { sag: { enabled } } }),
    },
    plugins: { enabled: false },
    logging: { file: path.join(root, "branch.log") },
  } satisfies BranchConfig;
  fs.writeFileSync(configPath, JSON.stringify(config));

  const entryPath = fileURLToPath(resolveRuntimeWorkerUrl(cliRecoveryEntrypoints.cli));
  const source = /\.[cm]?ts$/u.test(entryPath);
  const runtimeRoot = source
    ? createSourceRuntime(root)
    : createBuiltRuntime(root, path.dirname(entryPath));
  fs.symlinkSync(
    path.resolve("skills"),
    path.join(runtimeRoot, "skills"),
    process.platform === "win32" ? "junction" : "dir",
  );
  // No host credentials or Gateway endpoint enter this stopped-Gateway fixture.
  const env: NodeJS.ProcessEnv = {
    PATH: binDir,
    PATHEXT: ".CMD",
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    HOME: root,
    USERPROFILE: root,
    NODE_DISABLE_COMPILE_CACHE: "1",
    ESBUILD_WORKER_THREADS: "0",
    NO_COLOR: "1",
    BRANCH_CONFIG_PATH: configPath,
    BRANCH_STATE_DIR: path.join(root, "state"),
    BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
    BRANCH_HIDE_BANNER: "1",
    BRANCH_NO_RESPAWN: "1",
    BRANCH_PATH_BOOTSTRAPPED: "1",
    BRANCH_SERVICE_REPAIR_POLICY: "external",
    BRANCH_SKIP_CHANNELS: "1",
    BRANCH_TEST_FAST: "1",
  };
  const cli = async (args: string[]) => {
    const result = source
      ? await tempDirs.track(
          runSourceRuntime(
            runtimeRoot,
            env,
            [path.join(runtimeRoot, "src", "entry.ts"), ...args],
            60_000,
            4 * 1024 * 1024,
          ),
        )
      : await tempDirs.track(
          runBuiltRuntime(runtimeRoot, env, args, 60_000, { maxBuffer: 4 * 1024 * 1024 }),
        );
    const output = `${result.stderr}\n${result.stdout}`;
    expect(result.signal, output).toBeNull();
    expect(result.code, output).toBe(0);
    return result.stdout;
  };
  return { cli, configPath };
}

describe("bundled sag through the registered CLI", () => {
  it("accepts an installed binary without credential environment variables", async () => {
    const { cli } = await createSagCliFixture();
    const status = JSON.parse(await cli(["skills", "info", "sag", "--json"]));

    expect(status).toMatchObject({
      name: "sag",
      source: "branch-bundled",
      bundled: true,
      primaryEnv: "ELEVENLABS_API_KEY",
      requirements: { bins: ["sag"], env: [] },
      missing: { bins: [], env: [] },
      eligible: true,
      modelVisible: true,
      commandVisible: true,
    });
  }, 90_000);

  it("doctor --fix preserves an installed sag skill's enabled flag with the Gateway stopped", async () => {
    const { cli, configPath } = await createSagCliFixture(true);
    const output = await cli([
      "doctor",
      "--fix",
      "--non-interactive",
      "--no-workspace-suggestions",
    ]);

    expect(output).toContain("Doctor complete.");
    const saved: BranchConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.skills?.entries?.sag?.enabled, output).toBe(true);
  }, 90_000);
});
