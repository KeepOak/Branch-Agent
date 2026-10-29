import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfigFileSnapshot } from "../config/config.js";
import { writeBranchConfig } from "../config/test-helpers.js";
import { runInitialConfigWriteHealth } from "../flows/doctor-health-contribution-runners.config.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { readConfigMachineState } from "../state/config-machine-state.js";
import { withEnvAsync } from "../test-utils/env.js";
import { getFreePort } from "../test-utils/ports.js";
import { prepareDoctorContext } from "./doctor-config-flow.test-support.js";
import { useDoctorConfigPreflightHome } from "./doctor-config-preflight.test-support.js";

const withDoctorConfigPreflightHome = useDoctorConfigPreflightHome();
const windowsTouched = process.platform === "win32" && process.env.FEATURE_SCOPE === "touched";

async function repairConfig(configPath: string) {
  const ctx = await prepareDoctorContext(configPath);
  await runInitialConfigWriteHealth(ctx);
  return { ...ctx.configResult, configWriteRefusal: ctx.configWriteRefusal };
}

describe.skipIf(windowsTouched)("Doctor legacy config composition", () => {
  afterEach(() => closeBranchStateDatabaseForTest());

  it("preserves the July TTS preference locator before retiring its config keys", async () => {
    await withDoctorConfigPreflightHome(async (home) => {
      const prefsPath = path.join(home, "speech-preferences.json");
      const preferences = '{"tts":{"auto":"off","maxLength":1200}}\n';
      await fs.writeFile(prefsPath, preferences);
      const configPath = await writeBranchConfig(home, {
        agents: { list: [{ id: "main" }] },
        messages: { tts: { prefsPath, personas: { narrator: { prompt: { style: "calm" } } } } },
        gateway: { mode: "local" },
        plugins: { enabled: false },
      });
      await repairConfig(configPath);
      expect((await readConfigFileSnapshot()).valid).toBe(true);
      expect(readConfigMachineState("tts.prefsPath")).toBe(prefsPath);
      expect(await fs.readFile(prefsPath, "utf8")).toBe(preferences);
      const first = await fs.readFile(configPath, "utf8");
      expect(JSON.parse(first)).not.toHaveProperty("messages.tts");
      expect(JSON.parse(first)).not.toHaveProperty("tts.prefsPath");
      expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
      expect(await fs.readFile(configPath, "utf8")).toBe(first);
    });
  });

  it("canonicalizes July fixture memorySearch onto local meaning search", async () => {
    await withDoctorConfigPreflightHome(async (home) => {
      const raw = JSON.parse(
        await fs.readFile(
          new URL("../../test/fixtures/doctor-2026.7.1.json", import.meta.url),
          "utf8",
        ),
      );
      raw.agents.defaults.memorySearch.local = { modelPath: "/synthetic/embedding.gguf" };
      raw.gateway.port = await getFreePort();
      const configPath = await writeBranchConfig(home, raw);
      await repairConfig(configPath);
      const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(saved.agents).not.toHaveProperty("list");
      expect(saved.agents.ownership).toBe("explicit");
      expect(Object.keys(saved.agents.entries)).toEqual(["main", "research"]);
      expect(saved.memory.search.provider).toBe("local");
      expect(saved.memory.search.local).toEqual({ modelPath: "/synthetic/embedding.gguf" });
      expect(saved.memory.search).toEqual({ ...raw.agents.defaults.memorySearch });
      expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
    });
  });

  it.each(["duplicate ids", "whole-entry include"])(
    "refuses ambiguous legacy roster persistence for %s",
    async (shape) => {
      await withDoctorConfigPreflightHome(async (home) => {
        await withEnvAsync({ BRANCH_DISABLE_BUNDLED_PLUGINS: "1" }, async () => {
          const identity = { name: "Second agent" };
          const includeRaw = `${JSON.stringify(
            shape === "duplicate ids" ? identity : { identity, memorySearch: { enabled: false } },
            null,
            3,
          )}\n`;
          const configPath = await writeBranchConfig(home, {
            agents: {
              list:
                shape === "duplicate ids"
                  ? [
                      { id: "worker", name: "First agent" },
                      {
                        id: "worker",
                        name: "Second agent",
                        identity: { $include: "included.json" },
                      },
                    ]
                  : [{ id: "worker", $include: "included.json" }],
              ...(shape === "duplicate ids"
                ? { defaults: { memorySearch: { enabled: false } } }
                : {}),
            },
            gateway: { mode: "local" },
            plugins: { enabled: false },
          });
          const includePath = path.join(path.dirname(configPath), "included.json");
          await fs.writeFile(includePath, includeRaw);
          const rootRaw = await fs.readFile(configPath, "utf8");
          expect((await readConfigFileSnapshot()).valid).toBe(false);
          const refusal = await repairConfig(configPath).then(
            (result) => result.configWriteRefusal,
            (error: unknown) => {
              expect(error).toMatchObject({ message: expect.stringContaining("$include-owned") });
              return "include-ownership";
            },
          );
          expect(["validation", "include-ownership"]).toContain(refusal);
          expect(await fs.readFile(configPath, "utf8")).toBe(rootRaw);
          expect(await fs.readFile(includePath, "utf8")).toBe(includeRaw);
          expect((await readConfigFileSnapshot()).valid).toBe(false);
        });
      });
    },
  );
});
