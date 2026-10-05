// Daemon install plan tests cover shared install plan validation and platform warning helpers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTestNodeExecPath } from "../test-utils/node-process.js";
import {
  resolveDaemonInstallRuntimeInputs,
  resolveDaemonServicePathDirs,
} from "./daemon-install-plan.shared.js";

describe("resolveDaemonInstallRuntimeInputs", () => {
  it.skipIf(process.platform === "win32")(
    "keeps a persisted runtime pin instead of selecting system Node",
    async () => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-pin-")));
      const pinned = path.join(root, "node");
      try {
        fs.symlinkSync(resolveTestNodeExecPath(), pinned);
        await expect(
          resolveDaemonInstallRuntimeInputs({
            env: {},
            pinnedRuntimePath: pinned,
            runtime: "node",
            devMode: false,
          }),
        ).resolves.toEqual({ devMode: false, runtime: "node", runtimePath: pinned });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects a relative persisted pin instead of silently selecting another runtime", async () => {
    await expect(
      resolveDaemonInstallRuntimeInputs({
        env: {},
        pinnedRuntimePath: "relative/node",
        runtime: "node",
        devMode: false,
      }),
    ).rejects.toThrow(/absolute/);
  });

  it("detects src ts entrypoints when devMode is not overridden", async () => {
    const originalArgv = process.argv;
    try {
      for (const [entrypoint, expected] of [
        ["/Users/me/branch/src/cli/index.ts", true],
        ["C:\\Users\\me\\branch\\src\\cli\\index.ts", true],
        ["/Users/me/branch/dist/cli/index.js", false],
      ] as const) {
        process.argv = ["node", entrypoint];
        await expect(
          resolveDaemonInstallRuntimeInputs({
            env: {},
            runtime: "node",
            runtimePath: "/custom/node",
          }),
        ).resolves.toMatchObject({ devMode: expected });
      }
    } finally {
      process.argv = originalArgv;
    }
  });

  it("keeps explicit devMode and runtimePath overrides", async () => {
    await expect(
      resolveDaemonInstallRuntimeInputs({
        env: {},
        runtime: "node",
        devMode: false,
        runtimePath: "/custom/node",
      }),
    ).resolves.toEqual({
      devMode: false,
      runtime: "node",
      runtimePath: "/custom/node",
    });
  });
});

describe("resolveDaemonServicePathDirs branch discovery", () => {
  it("uses the active branch command directory", () => {
    expect(
      resolveDaemonServicePathDirs({
        argv: ["node", "/Users/testuser/.npm-global/bin/branch", "gateway", "install"],
        env: { PATH: "" },
        platform: "darwin",
      }),
    ).toEqual(["/Users/testuser/.npm-global/bin"]);
  });

  it.skipIf(process.platform === "win32")(
    "finds the PATH shim that resolves to the active package entrypoint",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-daemon-path-"));
      try {
        const binDir = path.join(root, "bin");
        const packageDir = path.join(root, "lib", "node_modules", "branch");
        const entrypoint = path.join(packageDir, "branch.mjs");
        fs.mkdirSync(binDir, { recursive: true });
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(entrypoint, "");
        fs.symlinkSync(entrypoint, path.join(binDir, "branch"));

        expect(
          resolveDaemonServicePathDirs({
            argv: ["node", entrypoint, "gateway", "install"],
            env: { PATH: binDir },
            platform: "darwin",
          }),
        ).toEqual([binDir]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "ignores unrelated branch commands elsewhere on PATH",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-daemon-path-"));
      try {
        const binDir = path.join(root, "bin");
        const activeEntrypoint = path.join(root, "active", "branch.mjs");
        const otherEntrypoint = path.join(root, "other", "branch.mjs");
        fs.mkdirSync(binDir, { recursive: true });
        fs.mkdirSync(path.dirname(activeEntrypoint), { recursive: true });
        fs.mkdirSync(path.dirname(otherEntrypoint), { recursive: true });
        fs.writeFileSync(activeEntrypoint, "");
        fs.writeFileSync(otherEntrypoint, "");
        for (const entrypoint of [activeEntrypoint, otherEntrypoint]) {
          fs.writeFileSync(
            path.join(path.dirname(entrypoint), "package.json"),
            '{"name":"branch"}',
          );
        }
        fs.symlinkSync(otherEntrypoint, path.join(binDir, "branch"));

        expect(
          resolveDaemonServicePathDirs({
            argv: ["node", activeEntrypoint, "gateway", "install"],
            env: { PATH: binDir },
            platform: "darwin",
          }),
        ).toBeUndefined();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});

describe("resolveDaemonServicePathDirs", () => {
  it("combines runtime and active branch command directories", () => {
    expect(
      resolveDaemonServicePathDirs({
        runtimePath: "/opt/homebrew/opt/node/bin/node",
        argv: ["node", "/Users/testuser/.npm-global/bin/branch", "gateway", "install"],
        env: { PATH: "" },
        platform: "darwin",
      }),
    ).toEqual(["/opt/homebrew/opt/node/bin", "/Users/testuser/.npm-global/bin"]);
  });
});
