import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core/expect";
import {
  createPluginStateKeyedStoreForTests as createPluginStateKeyedStore,
  resetPluginStateStoreForTests,
} from "branch/plugin-sdk/plugin-state-test-runtime";
import type {
  OpenKeyedStoreOptions,
  PluginDoctorStateMigrationContext,
} from "branch/plugin-sdk/runtime-doctor-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stateMigrations } from "./doctor-contract-api.js";

let stateDir: string;
let env: NodeJS.ProcessEnv;
const migration = expectDefined(stateMigrations[0], "Canopy retirement detector");

beforeAll(() => {
  // branch-temp-dir: allow closes the database owner before removing the suite fixture.
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-retired-"));
  env = { ...process.env, BRANCH_STATE_DIR: stateDir };
});

afterAll(() => {
  resetPluginStateStoreForTests();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function input(supportsCount: boolean) {
  const context: PluginDoctorStateMigrationContext = {
    openPluginStateKeyedStore<T>(options: OpenKeyedStoreOptions) {
      const store = createPluginStateKeyedStore<T>("canopy", options);
      return { ...store, count: supportsCount ? store.count : undefined };
    },
  };
  return { config: {}, env, stateDir, oauthDir: path.join(stateDir, "oauth"), context };
}

describe.each([true, false])("Canopy retirement with count support %s", (supportsCount) => {
  it("leaves installations without legacy rows alone", async () => {
    await expect(migration.detectLegacyState(input(supportsCount))).resolves.toBeNull();
    await expect(migration.migrateLegacyState(input(supportsCount))).resolves.toEqual({
      changes: [],
      warnings: [],
    });
  });

  it.each([
    ["canopy.cards", 2000],
    ["canopy.boards", 200],
    ["canopy.notify", 2000],
    ["canopy.attachments", 42_000],
  ])("preserves %s rows and names the recovery release", async (namespace, maxEntries) => {
    const store = createPluginStateKeyedStore<unknown>("canopy", { namespace, maxEntries, env });
    await store.register("retained", { version: 1, retained: namespace });
    const before = await store.entries();
    try {
      await expect(migration.detectLegacyState(input(supportsCount))).resolves.toEqual({
        preview: [expect.stringContaining("2026.9.7 and run branch doctor --fix")],
      });
      const result = await migration.migrateLegacyState(input(supportsCount));
      expect(result).toEqual({
        changes: [],
        warnings: [expect.stringContaining("2026.9.7 and run branch doctor --fix")],
      });
      expect(await store.entries()).toEqual(before);
    } finally {
      await store.delete("retained");
    }
  });
});
