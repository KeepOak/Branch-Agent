import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { getCliProcessTestTimeout } from "../cli/cli-process-child.test-helpers.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { writeBranchConfig } from "../config/test-helpers.js";
import { runInitialConfigWriteHealth } from "../flows/doctor-health-contribution-runners.config.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import { getFreePort } from "../test-utils/ports.js";
import { prepareDoctorContext } from "./doctor-config-flow.test-support.js";
import {
  createDoctorCliRuntime,
  runDoctorCli,
} from "./doctor-config-preflight.process.test-support.js";
import { useDoctorConfigPreflightHome } from "./doctor-config-preflight.test-support.js";

const CLI_CHILD_TIMEOUT_MS = 90_000;
const runtimeDirs = useAutoCleanupTempDirTracker(afterAll);
const withDoctorConfigPreflightHome = useDoctorConfigPreflightHome();
const windowsTouched = process.platform === "win32" && process.env.FEATURE_SCOPE === "touched";

async function repairConfig(configPath: string) {
  const ctx = await prepareDoctorContext(configPath);
  await runInitialConfigWriteHealth(ctx);
  return { ...ctx.configResult, configWriteRefusal: ctx.configWriteRefusal };
}

describe.skipIf(windowsTouched)("Doctor legacy config composition", () => {
  afterEach(() => closeBranchStateDatabaseForTest());

  it(
    "converges the July upgrade fixture with an explicit local model",
    async () => {
      const runtime = createDoctorCliRuntime(runtimeDirs.make("branch-doctor-legacy-runtime-"));
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
        const assertConverged = (saved: ReturnType<typeof JSON.parse>) => {
          expect(saved.agents).not.toHaveProperty("list");
          expect(saved.agents.ownership).toBe("explicit");
          expect(Object.keys(saved.agents.entries)).toEqual(["main", "research"]);
          expect(saved.agents.defaults.systemAgent.agentId).toBe("main");
          expect(saved.meta.migrations.modelPolicyAllowlist).toBe(true);
          expect(saved.agents.defaults.modelPolicy.allow).toEqual([
            "anthropic/claude-sonnet-4-6",
            "anthropic/claude-opus-4-7",
          ]);
          expect(saved.memory.search).toEqual({ ...raw.agents.defaults.memorySearch });
          expect(saved.tools.media.models).toEqual([
            { ...raw.tools.media.audio.models[0], capabilities: ["audio"] },
          ]);
          expect(saved.gateway.nodes.commands.deny).toEqual(["system.run"]);
          expect(saved.channels.telegram.groupAllowFrom).toEqual(["123456789"]);
          expect(saved.channels.telegram.accounts.secondary.groupAllowFrom).toEqual(["987654321"]);
          if (runtime.source) {
            expect(saved.tools.alsoAllow).toEqual(expect.arrayContaining(["browser"]));
          } else {
            expect(saved.plugins.entries.browser.enabled).toBe(true);
          }
          expect(saved.meta).not.toHaveProperty("lastTouchedAt");
          expect(saved.gateway.tailscale).not.toHaveProperty("resetOnExit");
        };

        if (runtime.source) {
          await withEnvAsync({ BRANCH_DISABLE_BUNDLED_PLUGINS: "1" }, async () => {
            expect((await readConfigFileSnapshot()).valid).toBe(false);
            await repairConfig(configPath);
            const first = await fs.readFile(configPath, "utf8");
            assertConverged(JSON.parse(first));
            expect((await readConfigFileSnapshot()).valid).toBe(true);
            expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
            expect(await fs.readFile(configPath, "utf8")).toBe(first);
          });
          return;
        }

        await fs.unlink(path.join(runtime.root, "src"));
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          WINDIR: process.env.WINDIR,
          ComSpec: process.env.ComSpec,
          HOME: home,
          USERPROFILE: home,
          TMPDIR: home,
          BRANCH_STATE_DIR: path.dirname(configPath),
          BRANCH_CONFIG_PATH: configPath,
          BRANCH_NO_RESPAWN: "1",
          BRANCH_SKIP_CHANNELS: "1",
          BRANCH_TEST_FAST: "1",
          NODE_COMPILE_CACHE: path.join(runtime.root, "node-compile-cache"),
          NO_COLOR: "1",
        };
        delete env.NODE_ENV;
        delete env.BRANCH_HOME;
        delete env.VITEST;
        const run = async (args: string[], expected = 0) => {
          const result = await runDoctorCli(runtime, env, args, CLI_CHILD_TIMEOUT_MS);
          const output = `${result.stdout}\n${result.stderr}`;
          expect(result.code, output).toBe(expected);
        };
        const doctorArgs = [
          "doctor",
          "--fix",
          "--non-interactive",
          "--yes",
          "--no-workspace-suggestions",
        ];
        await run(["config", "validate"], 1);
        await run(doctorArgs);
        const first = await fs.readFile(configPath, "utf8");
        await run(["config", "validate"]);
        assertConverged(JSON.parse(first));
        await run(doctorArgs);
        expect(await fs.readFile(configPath, "utf8")).toBe(first);
      });
    },
    getCliProcessTestTimeout(
      CLI_CHILD_TIMEOUT_MS,
      CLI_CHILD_TIMEOUT_MS,
      CLI_CHILD_TIMEOUT_MS,
      CLI_CHILD_TIMEOUT_MS,
    ),
  );

  it("preserves inherited message policy when an agent opts out of the legacy bypass", async () => {
    await withDoctorConfigPreflightHome(async (home) => {
      await withEnvAsync({ BRANCH_DISABLE_BUNDLED_PLUGINS: "1" }, async () => {
        const configPath = await writeBranchConfig(home, {
          tools: { message: { allowCrossContextSend: true } },
          agents: {
            ownership: "explicit",
            entries: {
              restricted: { tools: { message: { allowCrossContextSend: false } } },
              inherited: {},
            },
          },
          gateway: { mode: "local" },
          plugins: { enabled: false },
        });
        await repairConfig(configPath);
        const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
        expect(saved.agents.entries.restricted.tools.message).toEqual({
          crossContext: { allowWithinProvider: true, allowAcrossProviders: false },
        });
        expect(saved.tools.message).toEqual({
          crossContext: { allowWithinProvider: true, allowAcrossProviders: true },
        });
        expect((await readConfigFileSnapshot()).valid).toBe(true);
        expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
      });
    });
  });
  it.each([
    { apiKey: "$${DOCTOR_MEMORY_KEY}", provider: "auto", canonicalApiKey: undefined },
    {
      apiKey: "${DOCTOR_MEMORY_KEY}",
      provider: "${DOCTOR_MEMORY_PROVIDER}",
      canonicalApiKey: undefined,
    },
    {
      apiKey: "${DOCTOR_MEMORY_KEY}",
      provider: "auto",
      canonicalApiKey: "${DOCTOR_CANONICAL_MEMORY_KEY}",
    },
  ])(
    "preserves migrated $apiKey and canonical $canonicalApiKey references while canonicalizing $provider",
    async ({ apiKey, provider, canonicalApiKey }) => {
      await withDoctorConfigPreflightHome(async (home) => {
        await withEnvAsync(
          {
            BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
            DOCTOR_MEMORY_KEY: "memory-secret-canary",
            DOCTOR_MEMORY_PROVIDER: "auto",
            DOCTOR_CANONICAL_MEMORY_KEY: "canonical-secret-canary",
          },
          async () => {
            const configPath = await writeBranchConfig(home, {
              memory: {
                search: {
                  enabled: false,
                  query: { maxResults: 9 },
                  ...(canonicalApiKey ? { remote: { apiKey: canonicalApiKey } } : {}),
                },
              },
              agents: {
                defaults: {
                  memorySearch: {
                    enabled: true,
                    provider,
                    query: { maxResults: 7 },
                    remote: { apiKey },
                  },
                },
                entries: {
                  ops: {
                    memorySearch: { enabled: true, provider: "auto", query: { maxResults: 3 } },
                    memory: { search: { enabled: false, query: { maxResults: 5 } } },
                  },
                },
              },
              gateway: { mode: "local" },
              plugins: { enabled: false },
            });
            const ctx = await prepareDoctorContext(configPath);
            await withEnvAsync(
              {
                DOCTOR_MEMORY_KEY: "rotated-memory-secret-canary",
                DOCTOR_CANONICAL_MEMORY_KEY: "rotated-canonical-secret-canary",
              },
              async () => {
                await runInitialConfigWriteHealth(ctx);
                const snapshot = await readConfigFileSnapshot();
                expect(snapshot.valid).toBe(true);
                expect(snapshot.sourceConfig.memory?.search?.remote?.apiKey).toBe(
                  canonicalApiKey
                    ? "rotated-canonical-secret-canary"
                    : apiKey.startsWith("$$")
                      ? "${DOCTOR_MEMORY_KEY}"
                      : "rotated-memory-secret-canary",
                );
              },
            );
            const repaired = ctx.configResult;
            expect(ctx.configWriteRefusal).toBeUndefined();
            expect(repaired.cfg.memory?.search?.remote?.apiKey).toBe(
              canonicalApiKey
                ? "canonical-secret-canary"
                : apiKey.startsWith("$$")
                  ? "${DOCTOR_MEMORY_KEY}"
                  : "memory-secret-canary",
            );
            const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
            expect(saved.memory.search).toEqual({
              enabled: false,
              provider: "local",
              query: { maxResults: 9 },
              remote: { apiKey: canonicalApiKey ?? apiKey },
            });
            expect(saved.agents.defaults).not.toHaveProperty("memorySearch");
            expect(saved.agents.entries.ops.memory.search).toEqual({
              enabled: false,
              provider: "local",
              query: { maxResults: 5 },
            });
            expect(saved.agents.entries.ops).not.toHaveProperty("memorySearch");
            expect((await readConfigFileSnapshot()).valid).toBe(true);
            expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
          },
        );
      });
    },
  );

  it.each([true, false])(
    "preserves the shipped message bypass precedence for root %s",
    async (globalBypass) => {
      await withDoctorConfigPreflightHome(async (home) => {
        await withEnvAsync({ BRANCH_DISABLE_BUNDLED_PLUGINS: "1" }, async () => {
          const denied = { allowWithinProvider: false, allowAcrossProviders: false };
          const configPath = await writeBranchConfig(home, {
            tools: { message: { allowCrossContextSend: globalBypass, crossContext: denied } },
            agents: {
              ownership: "explicit",
              entries: {
                restricted: { tools: { message: { allowCrossContextSend: false } } },
                allowed: {
                  tools: {
                    message: {
                      allowCrossContextSend: true,
                      crossContext: { ...denied, marker: { enabled: false } },
                    },
                  },
                },
                inherited: { tools: { message: { crossContext: denied } } },
              },
            },
            gateway: { mode: "local" },
            plugins: { enabled: false },
          });
          await repairConfig(configPath);
          const snapshot = await readConfigFileSnapshot();
          expect(snapshot.valid).toBe(true);
          const { resolveEffectiveMessageToolsConfig } =
            await import("../infra/outbound/outbound-policy.js");
          const effective = (agentId: string) =>
            resolveEffectiveMessageToolsConfig({ cfg: snapshot.config, agentId });
          expect(effective("restricted")?.crossContext).toMatchObject(denied);
          expect(effective("allowed")?.crossContext).toEqual({
            allowWithinProvider: true,
            allowAcrossProviders: true,
            marker: { enabled: false },
          });
          expect(effective("inherited")?.crossContext).toEqual({
            allowWithinProvider: globalBypass,
            allowAcrossProviders: globalBypass,
          });
          expect(await fs.readFile(configPath, "utf8")).not.toContain("allowCrossContextSend");
          expect((await repairConfig(configPath)).shouldWriteConfig).toBe(false);
        });
      });
    },
  );
});
