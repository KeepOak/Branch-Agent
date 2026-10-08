import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureLifetime } from "./helpers/fixture-lifetime.js";

const LAUNCHER_FILES = [
  "branch.mjs",
  "node-host-launcher.mjs",
  "node-compile-cache.mjs",
  "node-version.mjs",
  "node-runtime-update.mjs",
  "node-runtime-recovery.mjs",
  "node-runtime-env.mjs",
  "cli-root-options.mjs",
  "gateway-run-argv.mjs",
  "gateway-shutdown-budget.mjs",
  "node-sqlite.mjs",
] as const;

function launcherEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.BRANCH_BUNDLED_PLUGINS_DIR;
  delete env.BRANCH_CONFIG_PATH;
  delete env.BRANCH_DISABLE_BUNDLED_PLUGINS;
  delete env.BRANCH_HOME;
  delete env.BRANCH_STATE_DIR;
  delete env.NODE_COMPILE_CACHE;
  delete env.NODE_DISABLE_COMPILE_CACHE;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

describe("branch Mac driver lease", () => {
  const fixtures = createFixtureLifetime();
  afterEach(() => fixtures.cleanup());

  it("keeps the lease across a packaged compile-cache respawn and strips it from helper children", async () => {
    const root = fixtures.createTempDir("branch-mac-lease-");
    for (const name of LAUNCHER_FILES) {
      await fs.copyFile(path.resolve(name), path.join(root, name));
    }
    await fs.mkdir(path.join(root, "dist"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), '{"version":"2026.8.1"}\n');
    const endpoint = JSON.stringify({ v: 2, port: 21831, secret: "a".repeat(64) });
    const endpointFile = path.join(root, "cua-endpoint");
    await fs.writeFile(endpointFile, endpoint, { mode: 0o600 });
    await fs.writeFile(
      path.join(root, "dist", "entry.js"),
      [
        'import { spawnSync } from "node:child_process";',
        "const helper = spawnSync(process.execPath, [",
        '  "-e",',
        '  "process.stdout.write(JSON.stringify({endpoint:process.env.BRANCH_CUA_DRIVER_ENDPOINT||\'\',file:process.env.BRANCH_CUA_DRIVER_ENDPOINT_FILE||\'\'}))",',
        "], { encoding: \"utf8\", windowsHide: true });",
        "process.stdout.write(JSON.stringify({",
        "  respawned: process.env.BRANCH_PACKAGED_COMPILE_CACHE_RESPAWNED === \"1\",",
        "  envEndpoint: process.env.BRANCH_CUA_DRIVER_ENDPOINT || \"\",",
        "  envFile: process.env.BRANCH_CUA_DRIVER_ENDPOINT_FILE || \"\",",
        "  resolved: globalThis[Symbol.for(\"branch.macComputerEndpoint\")] || \"\",",
        "  helper: JSON.parse(helper.stdout),",
        "}));",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, [path.join(root, "branch.mjs"), "gateway"], {
      cwd: root,
      env: launcherEnv({
        NODE_COMPILE_CACHE: path.join(root, ".node-compile-cache"),
        BRANCH_CUA_DRIVER_ENDPOINT_FILE: endpointFile,
        HOME: root,
      }),
      encoding: "utf8",
      timeout: 20_000,
      windowsHide: true,
    });

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      respawned: boolean;
      envEndpoint: string;
      envFile: string;
      resolved: string;
      helper: { endpoint: string; file: string };
    };
    expect(report.respawned).toBe(true);
    expect(report.resolved).toBe(endpoint);
    expect(report.envEndpoint).toBe("");
    expect(report.envFile).toBe("");
    expect(report.helper).toEqual({ endpoint: "", file: "" });
  });
});
