// Test environment tests validate shared env setup helpers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importFreshModule } from "branch/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inspectPersistedAuthProfileStateRaw,
  inspectPersistedAuthProfileStoreRaw,
  resolveAuthProfileDatabasePath,
  runAuthProfileWriteTransaction,
  writePersistedAuthProfileStateRaw,
  writePersistedAuthProfileStoreRaw,
} from "../src/agents/auth-profiles/sqlite.js";
import { isCurrentProcessLaunchdServiceLabel } from "../src/daemon/launchd-current-service.js";
import { detectGatewayRespawnSupervisor } from "../src/infra/supervisor-markers.js";
import { closeBranchAgentDatabaseByPath } from "../src/state/branch-agent-db.js";
import { closeBranchStateDatabaseByPath } from "../src/state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../src/state/branch-state-db.paths.js";
import {
  captureFullEnv,
  deleteTestEnvValue,
  setTestEnvValue,
  withEnv,
} from "../src/test-utils/env.js";
import { cleanupTempDirs, makeTempDir } from "./helpers/temp-dir.js";
import { installTestEnv } from "./test-env.js";

const originalEnv = captureFullEnv();

const tempDirs = new Set<string>();
const cleanupFns: Array<() => void> = [];

// Compare every key without printing ambient credentials in assertion failures.
function changedEnvKeys(expected: NodeJS.ProcessEnv): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(process.env)])].filter(
    (key) => expected[key] !== process.env[key],
  );
}

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function createTempHome(): string {
  return makeTempDir(tempDirs, "branch-test-env-real-home-");
}

function requireRecord(
  value: Record<string, unknown> | undefined,
  label: string,
): Record<string, unknown> {
  if (!value) {
    throw new Error(`expected copied ${label} config`);
  }
  return value;
}

function requireTelegramStreaming(
  value:
    | {
        mode?: string;
        chunkMode?: string;
        block?: { enabled?: boolean };
        preview?: { chunk?: { minChars?: number } };
      }
    | undefined,
) {
  if (!value) {
    throw new Error("expected copied telegram streaming config");
  }
  return value;
}

afterEach(() => {
  while (cleanupFns.length > 0) {
    cleanupFns.pop()?.();
  }
  originalEnv.restore();
  vi.restoreAllMocks();
  vi.doUnmock("node:child_process");
  cleanupTempDirs(tempDirs);
});

describe("installTestEnv", () => {
  it("isolates native manager sockets and restores the caller runtime directory", () => {
    const callerRuntime = path.join(createTempHome(), "runtime");
    withEnv({ XDG_RUNTIME_DIR: callerRuntime }, () => {
      const testEnv = installTestEnv({ mode: "hermetic" });
      cleanupFns.push(testEnv.cleanup);
      expect(process.env.XDG_RUNTIME_DIR).toBe(path.join(testEnv.tempHome, ".runtime"));
      testEnv.cleanup();
      expect(process.env.XDG_RUNTIME_DIR).toBe(callerRuntime);
    });
  });

  it.each([".branch", ".claude"])(
    "rolls back live staging failure at %s before another installation",
    (failedDirectory) => {
      const sandbox = makeTempDir(tempDirs, "branch-env-acquisition-");
      const realHome = createTempHome();
      writeFile(
        path.join(realHome, ".profile"),
        [
          "export ACQUISITION_PROFILE_ADDED=from-profile",
          "export ACQUISITION_PROFILE_EMPTY=from-profile",
          "export BRANCH_TEST_FAST=from-profile",
        ].join("\n"),
      );
      const configPath = path.join(realHome, ".branch", "branch.json");
      writeFile(configPath, "{}\n");
      writeFile(path.join(realHome, ".claude", "settings.json"), "{}\n");
      vi.spyOn(os, "tmpdir").mockReturnValue(sandbox);
      const snapshot = captureFullEnv();
      cleanupFns.push(() => snapshot.restore());

      withEnv(
        {
          HOME: realHome,
          USERPROFILE: realHome,
          BRANCH_HOME: realHome,
          BRANCH_STATE_DIR: path.join(realHome, ".branch"),
          BRANCH_CONFIG_PATH: configPath,
          BRANCH_AGENT_DIR: path.join(realHome, "caller-agent"),
          PI_CODING_AGENT_DIR: path.join(realHome, "caller-legacy-agent"),
          BRANCH_LIVE_TEST: "1",
          BRANCH_LIVE_USE_REAL_HOME: undefined,
          BRANCH_LIVE_TEST_QUIET: "1",
          BRANCH_TEST_FAST: "",
          COREPACK_HOME: undefined,
          ACQUISITION_PROFILE_ADDED: undefined,
          ACQUISITION_PROFILE_EMPTY: "",
        },
        () => {
          const callerEnv = { ...process.env };
          const failure = new Error(`staging failed at ${failedDirectory}`);
          const mkdirSync = fs.mkdirSync;
          let failedHome = "";
          const fault = vi.spyOn(fs, "mkdirSync").mockImplementation((target, options) => {
            const home = process.env.HOME;
            if (home && home !== realHome && target === path.join(home, failedDirectory)) {
              failedHome = home;
              throw failure;
            }
            return mkdirSync(target, options);
          });
          try {
            let caught: unknown;
            try {
              const unexpected = installTestEnv();
              cleanupFns.push(unexpected.cleanup);
            } catch (error) {
              caught = error;
            }
            expect(caught).toBe(failure);
          } finally {
            fault.mockRestore();
          }
          expect(failedHome).not.toBe("");
          expect.soft(changedEnvKeys(callerEnv)).toEqual([]);
          expect.soft(fs.existsSync(failedHome)).toBe(false);
          expect(fs.readdirSync(sandbox)).toEqual([]);
          expect(fs.readFileSync(configPath, "utf8")).toBe("{}\n");

          const next = installTestEnv();
          cleanupFns.push(next.cleanup);
          expect(next.tempHome).not.toBe(failedHome);
          expect(process.env.BRANCH_AGENT_DIR).toBeUndefined();
          expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
          expect(process.env.ACQUISITION_PROFILE_ADDED).toBe("from-profile");
          expect(process.env.ACQUISITION_PROFILE_EMPTY).toBe("from-profile");
          expect(
            fs.readFileSync(path.join(next.tempHome, ".claude", "settings.json"), "utf8"),
          ).toBe("{}\n");
          next.cleanup();
          expect(process.env.HOME).toBe(realHome);
          expect(process.env.BRANCH_AGENT_DIR).toBe(callerEnv.BRANCH_AGENT_DIR);
          expect(process.env.PI_CODING_AGENT_DIR).toBe(callerEnv.PI_CODING_AGENT_DIR);
          expect(process.env.BRANCH_TEST_FAST).toBe("from-profile");
          expect(process.env.ACQUISITION_PROFILE_ADDED).toBe("from-profile");
          expect(fs.readdirSync(sandbox)).toEqual([]);
        },
      );
    },
  );

  it("keeps live tests on a temp HOME while copying config and auth state", () => {
    const realHome = createTempHome();
    const branchHome = createTempHome();
    const priorIsolatedHome = createTempHome();
    writeFile(path.join(realHome, ".profile"), "export TEST_PROFILE_ONLY=from-profile\n");
    writeFile(
      path.join(branchHome, "custom-branch.json5"),
      `{
        // Preserve provider config, strip host-bound paths.
        agents: {
          defaults: {
            workspace: "/Users/peter/Projects",
            agentDir: "/Users/peter/.branch/agents/main/agent",
          },
          entries: {
            dev: {
              workspace: "/Users/peter/dev-workspace",
              agentDir: "/Users/peter/.branch/agents/dev/agent",
            },
          },
        },
        models: {
          providers: {
            custom: { baseUrl: "https://example.test/v1" },
          },
        },
        channels: {
          telegram: {
            streaming: {
              mode: "block",
              chunkMode: "newline",
              block: {
                enabled: true,
              },
              preview: {
                chunk: {
                  minChars: 120,
                },
              },
            },
          },
        },
      }`,
    );
    writeFile(path.join(branchHome, ".branch", "credentials", "token.txt"), "secret\n");
    writeFile(
      path.join(branchHome, ".branch", "external-plugins", "gluegrove", "branch.plugin.json"),
      '{"id":"gluegrove"}\n',
    );
    const realStateDir = path.join(branchHome, ".branch");
    const realAgentDir = path.join(realStateDir, "agents", "main", "agent");
    const liveAuthStore = {
      version: 1,
      profiles: {
        "openai:api-key": {
          type: "api_key",
          provider: "openai",
          keyRef: {
            source: "env",
            provider: "default",
            id: "BRANCH_LIVE_OPENAI_KEY",
          },
        },
      },
    };
    const liveAuthState = {
      version: 1,
      order: { openai: ["openai:api-key"] },
    };
    runAuthProfileWriteTransaction(
      realAgentDir,
      (database) => {
        writePersistedAuthProfileStoreRaw(liveAuthStore, realAgentDir, database);
        writePersistedAuthProfileStateRaw(liveAuthState, realAgentDir, database);
      },
      { stateDir: realStateDir },
    );
    cleanupFns.push(() => {
      closeBranchAgentDatabaseByPath(resolveAuthProfileDatabasePath(realAgentDir));
      closeBranchStateDatabaseByPath(
        resolveBranchStateSqlitePath({
          ...process.env,
          BRANCH_STATE_DIR: realStateDir,
        }),
      );
    });
    writeFile(path.join(realHome, ".claude", ".credentials.json"), '{"accessToken":"token"}\n');
    writeFile(path.join(realHome, ".claude", "projects", "old-session.jsonl"), "session\n");
    fs.mkdirSync(path.join(realHome, ".claude", "settings.local.json"), { recursive: true });
    writeFile(path.join(realHome, ".codex", "auth.json"), '{"OPENAI_API_KEY":"token"}\n');
    writeFile(path.join(realHome, ".codex", "config.toml"), 'model = "gpt-5.4"\n');
    writeFile(
      path.join(realHome, ".codex", "sessions", "2026", "02", "26", "rollout.jsonl"),
      "session\n",
    );
    writeFile(path.join(realHome, ".gemini", "oauth_creds.json"), '{"token":"gemini"}\n');
    writeFile(path.join(realHome, ".gemini", "settings.json"), '{"theme":"dark"}\n');
    writeFile(path.join(realHome, ".gemini", "commands", "Cache", "review.toml"), "prompt\n");
    writeFile(path.join(realHome, ".minimax", "Cache", "credentials.json"), "minimax\n");
    writeFile(
      path.join(
        realHome,
        ".gemini",
        "antigravity-browser-profile",
        "Default",
        "Cache",
        "Cache_Data",
        "blob",
      ),
      "cached-browser-bytes\n",
    );
    writeFile(
      path.join(realHome, ".gemini", "antigravity", "browser_recordings", "session.webm"),
      "recording\n",
    );
    writeFile(
      path.join(realHome, ".gemini", "cli-browser-profile", "Default", "History"),
      "browser-history\n",
    );
    writeFile(path.join(realHome, ".gemini", "GPUCache", "data.bin"), "gpu-cache\n");
    writeFile(
      path.join(realHome, ".gemini", "Service Worker", "CacheStorage", "cache.bin"),
      "worker-cache\n",
    );

    setTestEnvValue("HOME", realHome);
    setTestEnvValue("USERPROFILE", realHome);
    setTestEnvValue("BRANCH_HOME", branchHome);
    setTestEnvValue("BRANCH_LIVE_TEST", "1");
    setTestEnvValue("BRANCH_LIVE_TEST_QUIET", "1");
    setTestEnvValue("BRANCH_CONFIG_PATH", "~/custom-branch.json5");
    setTestEnvValue("BRANCH_TEST_HOME", priorIsolatedHome);
    setTestEnvValue("BRANCH_STATE_DIR", path.join(priorIsolatedHome, ".branch"));

    const testEnv = installTestEnv();
    cleanupFns.push(testEnv.cleanup);

    expect(testEnv.tempHome).not.toBe(realHome);
    expect(process.env.HOME).toBe(testEnv.tempHome);
    expect(process.env.BRANCH_HOME).toBeUndefined();
    expect(process.env.BRANCH_TEST_HOME).toBe(testEnv.tempHome);
    expect(process.env.TEST_PROFILE_ONLY).toBe("from-profile");

    const copiedConfigPath = path.join(testEnv.tempHome, ".branch", "branch.json");
    const copiedConfig = JSON.parse(fs.readFileSync(copiedConfigPath, "utf8")) as {
      agents?: {
        defaults?: Record<string, unknown>;
        entries?: Record<string, Record<string, unknown>>;
      };
      models?: { providers?: Record<string, unknown> };
      channels?: {
        telegram?: {
          streaming?: {
            mode?: string;
            chunkMode?: string;
            block?: { enabled?: boolean };
            preview?: { chunk?: { minChars?: number } };
          };
        };
      };
    };
    const providers = requireRecord(copiedConfig.models?.providers, "model providers");
    expect(providers.custom).toEqual({ baseUrl: "https://example.test/v1" });

    const agentDefaults = requireRecord(copiedConfig.agents?.defaults, "agent defaults");
    const agentConfig = requireRecord(copiedConfig.agents?.entries?.dev, "agent");
    expect(agentDefaults.workspace).toBeUndefined();
    expect(agentDefaults.agentDir).toBeUndefined();
    expect(agentConfig.workspace).toBeUndefined();
    expect(agentConfig.agentDir).toBeUndefined();

    const telegramStreaming = requireTelegramStreaming(copiedConfig.channels?.telegram?.streaming);
    expect(telegramStreaming).toEqual({
      mode: "block",
      chunkMode: "newline",
      block: { enabled: true },
      preview: { chunk: { minChars: 120 } },
    });

    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".branch", "credentials", "token.txt")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          testEnv.tempHome,
          ".branch",
          "external-plugins",
          "gluegrove",
          "branch.plugin.json",
        ),
      ),
    ).toBe(true);
    const stagedAgentDir = path.join(testEnv.tempHome, ".branch", "agents", "main", "agent");
    expect(inspectPersistedAuthProfileStoreRaw(stagedAgentDir)).toEqual({
      status: "readable",
      raw: liveAuthStore,
    });
    expect(inspectPersistedAuthProfileStateRaw(stagedAgentDir)).toEqual({
      status: "readable",
      raw: liveAuthState,
    });
    expect(fs.existsSync(path.join(stagedAgentDir, "auth-profiles.json"))).toBe(false);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".claude", ".credentials.json"))).toBe(true);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".claude", "projects"))).toBe(false);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".claude", "settings.local.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(testEnv.tempHome, ".codex", "auth.json"))).toBe(true);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".codex", "config.toml"))).toBe(true);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".codex", "sessions"))).toBe(false);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".gemini", "oauth_creds.json"))).toBe(true);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".gemini", "settings.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".gemini", "commands", "Cache", "review.toml")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".minimax", "Cache", "credentials.json")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".gemini", "antigravity-browser-profile")),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".gemini", "antigravity", "browser_recordings")),
    ).toBe(false);
    expect(fs.existsSync(path.join(testEnv.tempHome, ".gemini", "cli-browser-profile"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(testEnv.tempHome, ".gemini", "GPUCache"))).toBe(false);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".gemini", "Service Worker", "CacheStorage")),
    ).toBe(false);
  });

  it("allows explicit live runs against the real HOME", () => {
    const realHome = createTempHome();
    writeFile(path.join(realHome, ".profile"), "export TEST_PROFILE_ONLY=from-profile\n");

    setTestEnvValue("HOME", realHome);
    setTestEnvValue("USERPROFILE", realHome);
    setTestEnvValue("BRANCH_LIVE_TEST", "1");
    setTestEnvValue("BRANCH_LIVE_USE_REAL_HOME", "1");
    setTestEnvValue("BRANCH_LIVE_TEST_QUIET", "1");
    const agentDir = path.join(realHome, "caller-agent");
    const legacyAgentDir = path.join(realHome, "caller-legacy-agent");
    setTestEnvValue("BRANCH_AGENT_DIR", agentDir);
    setTestEnvValue("PI_CODING_AGENT_DIR", legacyAgentDir);

    const testEnv = installTestEnv();

    expect(testEnv.tempHome).toBe(realHome);
    expect(process.env.HOME).toBe(realHome);
    expect(process.env.TEST_PROFILE_ONLY).toBe("from-profile");
    expect(process.env.BRANCH_AGENT_DIR).toBe(agentDir);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(legacyAgentDir);
    testEnv.cleanup();
    expect(process.env.BRANCH_AGENT_DIR).toBe(agentDir);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(legacyAgentDir);
  });

  it("keeps hermetic mode isolated when live flags request the real HOME", () => {
    const realHome = createTempHome();
    writeFile(path.join(realHome, ".profile"), "export TEST_PROFILE_ONLY=from-profile\n");
    writeFile(path.join(realHome, ".branch", "branch.json"), '{"live":true}\n');
    writeFile(path.join(realHome, ".branch", "credentials", "token.txt"), "secret\n");

    setTestEnvValue("HOME", realHome);
    setTestEnvValue("USERPROFILE", realHome);
    setTestEnvValue("LIVE", "1");
    setTestEnvValue("BRANCH_LIVE_TEST", "1");
    setTestEnvValue("BRANCH_LIVE_GATEWAY", "1");
    setTestEnvValue("BRANCH_LIVE_USE_REAL_HOME", "1");
    const callerPluginDir = path.join(realHome, "caller-plugins");
    setTestEnvValue("BRANCH_BUNDLED_PLUGINS_DIR", callerPluginDir);
    setTestEnvValue("BRANCH_TEST_TRUST_BUNDLED_PLUGINS_DIR", "1");
    setTestEnvValue("BRANCH_DISABLE_BUNDLED_PLUGINS", "1");
    setTestEnvValue("BRANCH_HOME", realHome);
    setTestEnvValue("BRANCH_AGENT_DIR", path.join(realHome, "caller-agent"));
    setTestEnvValue("PI_CODING_AGENT_DIR", path.join(realHome, "caller-legacy-agent"));

    const testEnv = installTestEnv({ mode: "hermetic" });
    cleanupFns.push(testEnv.cleanup);

    expect(testEnv.tempHome).not.toBe(realHome);
    expect(process.env.HOME).toBe(testEnv.tempHome);
    expect(process.env.TEST_PROFILE_ONLY).toBeUndefined();
    expect(process.env.LIVE).toBeUndefined();
    expect(process.env.BRANCH_LIVE_TEST).toBeUndefined();
    expect(process.env.BRANCH_LIVE_GATEWAY).toBeUndefined();
    expect(process.env.BRANCH_LIVE_USE_REAL_HOME).toBeUndefined();
    expect(process.env.BRANCH_BUNDLED_PLUGINS_DIR).not.toBe(callerPluginDir);
    expect(path.basename(process.env.BRANCH_BUNDLED_PLUGINS_DIR ?? "")).toBe("extensions");
    expect(process.env.BRANCH_TEST_TRUST_BUNDLED_PLUGINS_DIR).toBe("1");
    expect(process.env.BRANCH_DISABLE_BUNDLED_PLUGINS).toBeUndefined();
    expect(process.env.BRANCH_HOME).toBeUndefined();
    expect(process.env.BRANCH_AGENT_DIR).toBeUndefined();
    expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(fs.existsSync(path.join(testEnv.tempHome, ".branch", "branch.json"))).toBe(false);
    expect(
      fs.existsSync(path.join(testEnv.tempHome, ".branch", "credentials", "token.txt")),
    ).toBe(false);
  });

  it.each(["BRANCH_HOME", "BRANCH_AGENT_DIR", "PI_CODING_AGENT_DIR"])(
    "clears and restores %s for normal isolated test runs",
    (key) => {
      const realHome = createTempHome();
      const callerPath = path.join(realHome, "caller-override");
      setTestEnvValue("HOME", realHome);
      setTestEnvValue("USERPROFILE", realHome);
      setTestEnvValue(key, callerPath);

      const testEnv = installTestEnv();
      cleanupFns.push(testEnv.cleanup);

      expect(testEnv.tempHome).not.toBe(realHome);
      expect(process.env[key]).toBeUndefined();
      setTestEnvValue(key, path.join(testEnv.tempHome, "explicit-override"));

      testEnv.cleanup();
      expect(process.env[key]).toBe(callerPath);
    },
  );

  it.each([
    {
      name: "explicit",
      corepack: "tool-cache",
      xdg: "xdg",
      local: "local",
      expected: "tool-cache",
    },
    { name: "explicit empty", corepack: "", xdg: "xdg", local: "local", expected: "" },
    { name: "explicit whitespace", corepack: " tool-cache ", expected: " tool-cache " },
    { name: "XDG before LOCALAPPDATA", xdg: "xdg", local: "local", expected: "xdg/node/corepack" },
    { name: "empty XDG", xdg: "", local: "local", expected: "node/corepack" },
    { name: "LOCALAPPDATA", local: "local", expected: "local/node/corepack" },
    { name: "empty LOCALAPPDATA", local: "", expected: "node/corepack" },
    { name: "OS home" },
  ])("preserves the $name Corepack cache across HOME isolation and cleanup", (testCase) => {
    const realHome = createTempHome();
    withEnv(
      {
        HOME: realHome,
        USERPROFILE: realHome,
        COREPACK_HOME: testCase.corepack,
        XDG_CACHE_HOME: testCase.xdg,
        LOCALAPPDATA: testCase.local,
      },
      () => {
        const callerEnv = { ...process.env };
        const expected =
          testCase.expected === undefined
            ? path.join(
                os.homedir(),
                process.platform === "win32" ? "AppData/Local" : ".cache",
                "node/corepack",
              )
            : testCase.corepack === undefined
              ? path.normalize(testCase.expected)
              : testCase.expected;
        const testEnv = installTestEnv({ mode: "hermetic" });
        cleanupFns.push(testEnv.cleanup);

        expect(process.env.HOME).toBe(testEnv.tempHome);
        expect(process.env.XDG_CACHE_HOME).toBe(path.join(testEnv.tempHome, ".cache"));
        expect(process.env.COREPACK_HOME).toBe(expected);
        setTestEnvValue("COREPACK_HOME", path.join(testEnv.tempHome, "changed-tool-cache"));
        testEnv.cleanup();
        expect(changedEnvKeys(callerEnv)).toEqual([]);
        expect(fs.existsSync(testEnv.tempHome)).toBe(false);
      },
    );
  });

  it.each([
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "TWILIO_SMS_FROM",
    "TWILIO_MESSAGING_SERVICE_SID",
  ])("isolates and restores the SMS activation variable %s", (key) => {
    setTestEnvValue(key, "test-channel-value");

    const testEnv = installTestEnv({ mode: "hermetic" });
    cleanupFns.push(testEnv.cleanup);

    expect(process.env[key]).toBeUndefined();
    testEnv.cleanup();
    expect(process.env[key]).toBe("test-channel-value");
  });

  it.each(["live-aware", "hermetic"] as const)(
    "isolates and restores inherited supervisor identity in %s mode",
    (mode) => {
      const supervisorEnv = {
        LAUNCH_JOB_LABEL: "ai.branch.gateway",
        LAUNCH_JOB_NAME: "ai.branch.gateway",
        XPC_SERVICE_NAME: "ai.branch.gateway",
        BRANCH_LAUNCHD_LABEL: "ai.branch.gateway",
        BRANCH_SERVICE_MARKER: "branch",
        BRANCH_SERVICE_KIND: "gateway",
        BRANCH_SYSTEMD_UNIT: "branch-gateway.service",
        INVOCATION_ID: "test-invocation",
        SYSTEMD_EXEC_PID: "1234",
        JOURNAL_STREAM: "8:1234",
        BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway",
        BRANCH_SUPERVISOR_MODE: "external",
        BRANCH_WRAPPER: "/fixture/operator-wrapper",
        BRANCH_GATEWAY_SERVICE_PID: "4321",
        BRANCH_SERVICE_MANAGED_ENV_KEYS: "FIXTURE_AUTH_REF",
        BRANCH_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
      };
      for (const [key, value] of Object.entries(supervisorEnv)) {
        setTestEnvValue(key, value);
      }
      setTestEnvValue("TEST_UNRELATED_SERVICE_HINT", "preserved");

      const testEnv = installTestEnv({ mode });
      cleanupFns.push(testEnv.cleanup);

      expect(isCurrentProcessLaunchdServiceLabel("ai.branch.gateway")).toBe(false);
      for (const platform of ["darwin", "linux", "win32"] as const) {
        expect(detectGatewayRespawnSupervisor(process.env, platform)).toBeNull();
      }
      expect(Object.keys(supervisorEnv).filter((key) => process.env[key] !== undefined)).toEqual(
        [],
      );
      expect(process.env.TEST_UNRELATED_SERVICE_HINT).toBe("preserved");
      withEnv({ XPC_SERVICE_NAME: "ai.branch.gateway" }, () => {
        expect(isCurrentProcessLaunchdServiceLabel("ai.branch.gateway")).toBe(true);
      });
      withEnv({ XPC_SERVICE_NAME: "0" }, () => {
        expect(isCurrentProcessLaunchdServiceLabel("ai.branch.gateway")).toBe(false);
      });

      testEnv.cleanup();
      for (const [key, value] of Object.entries(supervisorEnv)) {
        expect(process.env[key]).toBe(value);
      }
    },
  );

  it("does not load ~/.profile for normal isolated test runs", () => {
    const realHome = createTempHome();
    writeFile(path.join(realHome, ".profile"), "export TEST_PROFILE_ONLY=from-profile\n");

    setTestEnvValue("HOME", realHome);
    setTestEnvValue("USERPROFILE", realHome);
    deleteTestEnvValue("LIVE");
    deleteTestEnvValue("BRANCH_LIVE_TEST");
    deleteTestEnvValue("BRANCH_LIVE_GATEWAY");
    deleteTestEnvValue("BRANCH_LIVE_USE_REAL_HOME");
    deleteTestEnvValue("BRANCH_LIVE_TEST_QUIET");

    const testEnv = installTestEnv();
    cleanupFns.push(testEnv.cleanup);

    expect(testEnv.tempHome).not.toBe(realHome);
    expect(process.env.TEST_PROFILE_ONLY).toBeUndefined();
  });

  it("falls back to parsing ~/.profile when bash is unavailable", async () => {
    const realHome = createTempHome();
    writeFile(path.join(realHome, ".profile"), "export TEST_PROFILE_ONLY=from-profile\n");

    setTestEnvValue("HOME", realHome);
    setTestEnvValue("USERPROFILE", realHome);
    setTestEnvValue("BRANCH_LIVE_TEST", "1");
    setTestEnvValue("BRANCH_LIVE_USE_REAL_HOME", "1");
    setTestEnvValue("BRANCH_LIVE_TEST_QUIET", "1");

    vi.doMock("node:child_process", () => ({
      execFileSync: () => {
        throw Object.assign(new Error("bash missing"), { code: "ENOENT" });
      },
    }));

    const { installTestEnv: installFreshTestEnv } = await importFreshModule<
      typeof import("./test-env.js")
    >(import.meta.url, "./test-env.js?scope=profile-fallback");

    const testEnv = installFreshTestEnv();

    expect(testEnv.tempHome).toBe(realHome);
    expect(process.env.TEST_PROFILE_ONLY).toBe("from-profile");
  });
});
