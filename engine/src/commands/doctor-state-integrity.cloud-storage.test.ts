import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  detectMacCloudSyncedStateDir,
  detectWindowsCloudSyncedStateDir,
  formatWindowsCloudSyncedStateDirWarning,
} from "./doctor-state-integrity.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("cloud-synced state directories", () => {
  it("anchors iCloud detection to the OS home despite BRANCH_HOME", () => {
    const home = path.resolve("/Users/tester");
    const stateDir = path.join(home, "Library/Mobile Documents/com~apple~CloudDocs/.branch");
    vi.stubEnv("BRANCH_HOME", "/tmp/branch-home-override");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    expect(detectMacCloudSyncedStateDir(stateDir, { platform: "darwin" })).toEqual({
      path: stateDir,
      storage: "iCloud Drive",
    });
  });

  it.each([false, true])(
    "resolves a missing macOS state leaf through its ancestor (local symlink=%s)",
    (local) => {
      const sandbox = fs.realpathSync(tempDirs.make("branch-cloud-storage-"));
      const home = path.join(sandbox, "home");
      const cloudRoot = path.join(home, "Library", "CloudStorage");
      const syncedDir = path.join(cloudRoot, "OneDrive-Personal");
      fs.mkdirSync(cloudRoot, { recursive: true });
      if (local) {
        const target = path.join(sandbox, "local-branch");
        fs.mkdirSync(target);
        fs.symlinkSync(target, syncedDir, process.platform === "win32" ? "junction" : "dir");
      } else {
        fs.mkdirSync(syncedDir);
      }
      const stateDir = path.join(syncedDir, "Branch Agent", ".branch");
      expect(fs.existsSync(stateDir)).toBe(false);
      expect(detectMacCloudSyncedStateDir(stateDir, { platform: "darwin", homedir: home })).toEqual(
        local ? null : { path: stateDir, storage: "CloudStorage provider" },
      );
    },
  );

  it("detects a missing OneDrive business leaf case-insensitively and explains service relocation", () => {
    const personal = path.resolve("/Users/tester/OneDrive");
    const business = path.resolve("/Users/tester/OneDrive - Contoso");
    const root = path.join(business, "Branch Agent").toUpperCase();
    const stateDir = path.join(root, ".branch");
    const result = detectWindowsCloudSyncedStateDir(stateDir, {
      platform: "win32",
      env: Object.freeze({
        OneDrive: personal,
        onedriveconsumer: personal,
        oNeDrIvEcOmMeRcIaL: business,
      }),
      resolveRealPath: (target) => (target === root ? root : null),
    });
    expect(result).toEqual({ path: stateDir, storage: "OneDrive for Business" });
    if (!result) {
      throw new Error("expected OneDrive warning");
    }
    const warning = formatWindowsCloudSyncedStateDirWarning(stateDir, result);
    expect(warning).toContain("Windows cloud-synced storage");
    expect(warning).toContain("OneDrive for Business");
    expect(warning).toContain("stop the Gateway");
    expect(warning).toContain("for the Gateway service");
    expect(warning).toContain("re-run doctor");
    expect(warning).not.toMatch(/(?:^|\s)BRANCH_STATE_DIR=\S+\s+\S*branch\b/m);
    expect(warning).not.toContain("$env:BRANCH_STATE_DIR");
    expect(warning).not.toContain('set "BRANCH_STATE_DIR=');
  });

  it("follows a junction out of OneDrive when the state leaf is absent", () => {
    const root = path.resolve("/Users/tester/OneDrive/Branch");
    expect(
      detectWindowsCloudSyncedStateDir(path.join(root, ".branch"), {
        platform: "win32",
        env: { OneDrive: path.dirname(root) },
        resolveRealPath: (target) => (target === root ? path.resolve("/local-branch") : null),
      }),
    ).toBeNull();
  });

  it("does not infer a sync root from a OneDrive-named folder without the client's environment", () => {
    expect(
      detectWindowsCloudSyncedStateDir(path.resolve("/Users/tester/OneDrive/.branch"), {
        platform: "win32",
        env: {},
      }),
    ).toBeNull();
  });
});
