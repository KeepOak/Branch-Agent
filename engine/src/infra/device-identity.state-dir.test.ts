// Covers default device identity SQLite path under the state dir.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { loadDeviceIdentityIfPresent, loadOrCreateDeviceIdentity } from "./device-identity.js";

afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.restoreAllMocks();
});

describe("device identity state dir defaults", () => {
  it("writes the default identity to the shared state database", async () => {
    await withStateDirEnv("branch-identity-state-", async ({ stateDir }) => {
      const identity = loadOrCreateDeviceIdentity();
      const databasePath = path.join(stateDir, "state", "branch.sqlite");

      expect(loadDeviceIdentityIfPresent()).toEqual(identity);
      expect(fs.existsSync(databasePath)).toBe(true);
      expect(fs.readdirSync(stateDir)).toEqual(["state"]);
      expect(fs.existsSync(path.join(stateDir, "identity", "device.json"))).toBe(false);
    });
  });

  it("reuses the stored identity on subsequent loads", async () => {
    await withStateDirEnv("branch-identity-state-", async () => {
      const first = loadOrCreateDeviceIdentity();
      const second = loadOrCreateDeviceIdentity();

      expect(second).toEqual(first);
    });
  });

  it("uses the supplied state environment and removes its schema ownership marker", async () => {
    await withTempDir("branch-identity-env-state-", async (rootDir) => {
      const stateDir = path.join(rootDir, "selected-state");
      const fakeHome = path.join(rootDir, "home");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.mkdirSync(fakeHome, { recursive: true });
      const env = {
        ...process.env,
        HOME: fakeHome,
        BRANCH_HOME: fakeHome,
        BRANCH_STATE_DIR: stateDir,
      };

      const identity = loadOrCreateDeviceIdentity({ env });

      expect(loadDeviceIdentityIfPresent({ env })).toEqual(identity);
      expect(fs.readdirSync(stateDir)).toEqual(["state"]);
      expect(fs.existsSync(path.join(fakeHome, ".branch"))).toBe(false);
    });
  });

  it("keeps read-only lookup non-creating when the default database is absent", async () => {
    await withStateDirEnv("branch-identity-state-", async ({ stateDir }) => {
      const databasePath = path.join(stateDir, "state", "branch.sqlite");

      expect(loadDeviceIdentityIfPresent()).toBeNull();
      expect(fs.existsSync(databasePath)).toBe(false);
    });
  });
});
