// #1053: the desktop app's standard install (its own engine home under its standard data folder) owns the
// per-user engine service on every OS; custom copies keep the skip.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON,
  resolveGatewayServiceMutationError,
} from "../infra/gateway-supervision.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { isDefaultInstallIdentity } from "./paths.js";

/** The environment desktop/src/gateway.ts engineEnvironment gives the engine CLI for an app data folder. */
function appEnv(home: string, dataDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const engineHome = path.join(dataDir, "home");
  return {
    HOME: home,
    BRANCH_PROFILE: "default",
    BRANCH_HOME: engineHome,
    BRANCH_STATE_DIR: path.join(engineHome, ".branch"),
    BRANCH_CONFIG_PATH: path.join(engineHome, ".branch", "branch.json"),
    ...extra,
  };
}

const home = "/home/test";

describe("desktop app install identity (#1053)", () => {
  it.each([
    {
      name: "macOS Application Support",
      platform: "darwin" as const,
      dataDir: path.join(home, "Library", "Application Support", "BranchAgent"),
      extra: {},
    },
    {
      name: "Linux AppImage/tar without XDG_DATA_HOME",
      platform: "linux" as const,
      dataDir: path.join(home, ".local", "share", "BranchAgent"),
      extra: {},
    },
    {
      name: "Linux with XDG_DATA_HOME",
      platform: "linux" as const,
      dataDir: path.join("/data", "test", "share", "BranchAgent"),
      extra: { XDG_DATA_HOME: "/data/test/share" },
    },
    {
      name: "Linux AppImage runtime layout",
      platform: "linux" as const,
      dataDir: path.join(home, ".local", "share", "BranchAgent"),
      extra: {
        APPDIR: "/tmp/.mount_BranchA1b2C3",
        APPIMAGE: path.join(home, "Applications", "Branch-Agent.AppImage"),
        ARGV0: "./Branch-Agent.AppImage",
        OWD: home,
        XDG_DATA_DIRS: "/tmp/.mount_BranchA1b2C3/usr/share:/usr/local/share:/usr/share",
      },
    },
    {
      name: "Windows LOCALAPPDATA",
      platform: "win32" as const,
      dataDir: path.join(home, "AppData", "Local", "BranchAgent"),
      extra: { LOCALAPPDATA: path.join(home, "AppData", "Local") },
    },
    {
      name: "the legacy BranchApp folder",
      platform: "linux" as const,
      dataDir: path.join(home, "BranchApp"),
      extra: {},
    },
  ])("gets the service for $name", ({ platform, dataDir, extra }) => {
    expect(isDefaultInstallIdentity(appEnv(home, dataDir, extra), () => home, platform)).toBe(true);
  });

  it("gets the service with trailing slashes and ~ in the app's paths", () => {
    const dataDir = path.join(home, ".local", "share", "BranchAgent");
    const env = appEnv(home, dataDir);
    expect(
      isDefaultInstallIdentity(
        {
          ...env,
          BRANCH_HOME: `${env.BRANCH_HOME}/`,
          BRANCH_STATE_DIR: `${env.BRANCH_STATE_DIR}/`,
        },
        () => home,
        "linux",
      ),
    ).toBe(true);
    expect(
      isDefaultInstallIdentity(
        { ...env, BRANCH_HOME: "~/.local/share/BranchAgent/home" },
        () => home,
        "linux",
      ),
    ).toBe(true);
  });

  it("gets the service when the data folder or the account home is reached through a symlink", async () => {
    await withTestDir({ prefix: "branch-1053-symlink-" }, async (root) => {
      // The account home as the password database names it is a symlink to the real one (a NAS volume).
      const realHome = path.join(root, "volume1", "homes", "test");
      const linkedHome = path.join(root, "homes-test");
      // The app's data folder itself lives on another disk, linked from its standard place.
      const realData = path.join(root, "disk", "BranchAgent-data");
      await fs.mkdir(path.join(realData, "home", ".branch"), { recursive: true });
      await fs.mkdir(path.join(realHome, "Library", "Application Support"), { recursive: true });
      await fs.symlink(realHome, linkedHome, "dir");
      await fs.symlink(
        realData,
        path.join(realHome, "Library", "Application Support", "BranchAgent"),
        "dir",
      );
      const standard = path.join(linkedHome, "Library", "Application Support", "BranchAgent");
      for (const processHome of [realHome, linkedHome]) {
        // The app names the standard (symlinked) folder.
        expect(
          isDefaultInstallIdentity(appEnv(processHome, standard), () => linkedHome, "darwin"),
        ).toBe(true);
        // Or the folder it really is.
        expect(
          isDefaultInstallIdentity(appEnv(processHome, realData), () => linkedHome, "darwin"),
        ).toBe(true);
      }
    });
  });

  it("lets the engine service commands through for the app's standard install", () => {
    const accountHome = os.userInfo().homedir;
    const dataDir =
      process.platform === "darwin"
        ? path.join(accountHome, "Library", "Application Support", "BranchAgent")
        : process.platform === "win32"
          ? path.join(accountHome, "AppData", "Local", "BranchAgent")
          : path.join(accountHome, ".local", "share", "BranchAgent");
    const env = appEnv(accountHome, dataDir, {
      USERPROFILE: accountHome,
      LOCALAPPDATA: path.join(accountHome, "AppData", "Local"),
      XDG_DATA_HOME: undefined,
    });
    expect(resolveGatewayServiceMutationError("install or rewrite the gateway service", env)).toBe(
      null,
    );
  });

  it("keeps the skip for custom setups", () => {
    const standard = path.join(home, ".local", "share", "BranchAgent");
    const custom = [
      // A data folder the owner moved (desktop.json dataDir or BRANCH_DESKTOP_DATA).
      appEnv(home, "/srv/branch-data", { BRANCH_DESKTOP_DATA: "/srv/branch-data" }),
      // A scratch test copy and a hidden run, even on the standard folder.
      appEnv(home, standard, { BRANCH_DESKTOP_TEST: "1" }),
      appEnv(home, standard, { BRANCH_DESKTOP_HIDDEN: "1" }),
      // A non-default state dir or config path under the standard engine home.
      appEnv(home, standard, { BRANCH_STATE_DIR: "/srv/elsewhere/.branch" }),
      appEnv(home, standard, { BRANCH_CONFIG_PATH: "/srv/elsewhere/branch.json" }),
      // The legacy dev profile and other named profiles are not the app's service.
      appEnv(home, standard, {
        BRANCH_PROFILE: "dev",
        BRANCH_STATE_DIR: undefined,
        BRANCH_CONFIG_PATH: undefined,
      }),
      // A relative XDG_DATA_HOME is not a data home.
      appEnv(home, path.join("rel", "BranchAgent"), { XDG_DATA_HOME: "rel" }),
      // A test engine profile that relocates the process home.
      appEnv("/tmp/engine-profile", standard),
      // Another OS's standard folder.
      appEnv(home, path.join(home, "Library", "Application Support", "BranchAgent")),
    ];
    for (const env of custom) {
      expect(isDefaultInstallIdentity(env, () => home, "linux")).toBe(false);
    }
  });

  it("names the skip for a custom data folder", () => {
    const accountHome = os.userInfo().homedir;
    const error = resolveGatewayServiceMutationError(
      "install or rewrite the gateway service",
      appEnv(accountHome, path.join(accountHome, "branch-test-copy-1053")),
    );
    expect(error?.message).toContain(NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON);
  });
});
