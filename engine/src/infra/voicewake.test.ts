// Covers voice wake trigger defaults, sanitization, and persistence.
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  defaultVoiceWakeTriggers,
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
} from "./voicewake.js";

async function withVoiceWakeDir<T>(run: (baseDir: string) => Promise<T>): Promise<T> {
  return await withTempDir("branch-voicewake-", async (baseDir) => {
    try {
      return await run(baseDir);
    } finally {
      // Windows cannot unlink branch.sqlite while the cached state handle is open.
      await closeBranchStateDatabaseAsync();
      closeBranchStateDatabaseForTest();
    }
  });
}

describe("voicewake config", () => {
  it("returns defaults when missing", async () => {
    await withVoiceWakeDir(async (baseDir) => {
      await expect(loadVoiceWakeConfig(baseDir)).resolves.toEqual({
        triggers: defaultVoiceWakeTriggers(),
        updatedAtMs: 0,
      });
    });
  });

  it("sanitizes and persists triggers", async () => {
    await withVoiceWakeDir(async (baseDir) => {
      const saved = await setVoiceWakeTriggers(["  hi  ", "", "  there "], baseDir);
      expect(saved.triggers).toEqual(["hi", "there"]);
      expect(saved.updatedAtMs).toBeGreaterThan(0);

      await expect(loadVoiceWakeConfig(baseDir)).resolves.toEqual({
        triggers: ["hi", "there"],
        updatedAtMs: saved.updatedAtMs,
      });
    });
  });

  it("does not read retired JSON trigger files at runtime", async () => {
    await withVoiceWakeDir(async (baseDir) => {
      await fs.mkdir(path.join(baseDir, "settings"), { recursive: true });
      await fs.writeFile(
        path.join(baseDir, "settings", "voicewake.json"),
        JSON.stringify({
          triggers: ["  wake ", "", 42, null],
          updatedAtMs: -1,
        }),
        "utf8",
      );

      await expect(loadVoiceWakeConfig(baseDir)).resolves.toEqual({
        triggers: defaultVoiceWakeTriggers(),
        updatedAtMs: 0,
      });
    });
  });

  it("does not recreate the retired JSON trigger file", async () => {
    await withVoiceWakeDir(async (baseDir) => {
      await setVoiceWakeTriggers(["wake"], baseDir);
      await expect(fs.readFile(path.join(baseDir, "settings", "voicewake.json"))).rejects.toThrow(
        /ENOENT/u,
      );
    });
  });
});
