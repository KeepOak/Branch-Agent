// Covers config path resolution across env, home, and agent roots.
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveLegacyOAuthPath } from "../agents/auth-profiles/legacy-source-diagnostic.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  allowsProcessHomeSessionScan,
  CONFIG_PATH,
  DEFAULT_GATEWAY_PORT,
  isDefaultInstallIdentity,
  isDefaultStateDir,
  isNixMode,
  normalizeStateDirEnv,
  pinRuntimePaths,
  resolveNativeServiceProfileConflict,
  resolveDefaultConfigCandidates,
  resolveCanonicalConfigPath,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveGatewayPort,
  resolveIncludeRoots,
  resolveOAuthDir,
  resolveStateDir,
  STATE_DIR,
} from "./paths.js";

describe("default state directory", () => {
  it("matches filesystem aliases of the default state directory", async () => {
    await withTestDir({ prefix: "branch-default-state-" }, async (root) => {
      const home = path.join(root, "home");
      const defaultStateDir = path.join(home, ".branch");
      const stateAlias = path.join(home, "state-alias");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.symlink(defaultStateDir, stateAlias, "dir");

      expect(isDefaultStateDir({ HOME: home, BRANCH_STATE_DIR: stateAlias }, () => home)).toBe(
        true,
      );
    });
  });
});

describe("default install identity", () => {
  it("accepts default paths and equivalent explicit overrides", () => {
    const home = "/home/test";
    const stateDir = path.join(home, ".branch");
    const configPath = path.join(stateDir, "branch.json");

    expect(isDefaultInstallIdentity({ HOME: home }, () => home)).toBe(true);
    expect(allowsProcessHomeSessionScan({ HOME: home }, () => home)).toBe(true);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, BRANCH_STATE_DIR: stateDir, BRANCH_CONFIG_PATH: configPath },
        () => home,
      ),
    ).toBe(true);
  });

  it("preserves implicit legacy config discovery for the default profile", async () => {
    await withTestDir({ prefix: "branch-default-install-legacy-config-" }, async (home) => {
      const stateDir = path.join(home, ".branch");
      const legacyStateDir = path.join(home, ".clawdbot");
      const legacyConfigPath = path.join(legacyStateDir, "clawdbot.json");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(legacyStateDir, { recursive: true });
      await fs.writeFile(legacyConfigPath, "{}");

      const env = { HOME: home };
      expect(resolveConfigPathCandidate(env, () => home)).toBe(legacyConfigPath);
      expect(isDefaultInstallIdentity(env, () => home)).toBe(true);
    });
  });

  it("rejects non-default state or config paths", () => {
    const home = "/home/test";

    expect(
      isDefaultInstallIdentity({ HOME: home, BRANCH_STATE_DIR: "/tmp/copied-state" }, () => home),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, BRANCH_CONFIG_PATH: "/tmp/copied-branch.json" },
        () => home,
      ),
    ).toBe(false);
  });

  it("rejects process home overrides that relocate the implicit install", () => {
    const accountHome = "/home/test";
    const stateDir = path.join(accountHome, ".branch");

    expect(isDefaultInstallIdentity({ HOME: "/tmp/copied-home" }, () => accountHome)).toBe(false);
    for (const processHome of ["HOME", "USERPROFILE"]) {
      const env = { [processHome]: "/tmp/copied-home", BRANCH_HOME: accountHome };
      expect(isDefaultInstallIdentity(env, () => accountHome)).toBe(false);
      expect(allowsProcessHomeSessionScan(env, () => accountHome)).toBe(false);
    }
    expect(
      isDefaultInstallIdentity(
        {
          HOME: "/tmp/copied-home",
          BRANCH_STATE_DIR: stateDir,
          BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          USERPROFILE: "/tmp/copied-home",
          BRANCH_STATE_DIR: stateDir,
          BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("rejects installs relocated through BRANCH_HOME", () => {
    const accountHome = "/home/test";
    const installHome = "/srv/branch";
    const stateDir = path.join(installHome, ".branch");

    expect(isDefaultInstallIdentity({ BRANCH_HOME: installHome }, () => accountHome)).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          BRANCH_HOME: installHome,
          BRANCH_STATE_DIR: stateDir,
          BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          BRANCH_HOME: installHome,
          BRANCH_PROFILE: "work",
          BRANCH_STATE_DIR: path.join(installHome, ".branch-work"),
          BRANCH_CONFIG_PATH: path.join(installHome, ".branch-work", "branch.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("keeps the default install identity for unset home literals", () => {
    const home = "/home/test";

    for (const literal of ["undefined", "null", "  undefined  "]) {
      const env = { HOME: home, BRANCH_HOME: literal };
      // Home resolution already reads these literals as unset, so the install
      // stays on the account home and the default state dir.
      expect(isDefaultInstallIdentity(env, () => home)).toBe(true);
      expect(allowsProcessHomeSessionScan(env, () => home)).toBe(true);
    }
  });

  it("accepts the canonical paths a named profile projects", async () => {
    await withTestDir({ prefix: "branch-profile-install-" }, async (home) => {
      const defaultStateDir = path.join(home, ".branch");
      const profileStateDir = path.join(home, ".branch-work");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.writeFile(path.join(defaultStateDir, "branch.json"), "{}");

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: profileStateDir,
            BRANCH_CONFIG_PATH: path.join(profileStateDir, "branch.json"),
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        allowsProcessHomeSessionScan(
          {
            HOME: home,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: profileStateDir,
            BRANCH_CONFIG_PATH: path.join(profileStateDir, "branch.json"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(false);

      await fs.mkdir(profileStateDir, { recursive: true });
      await fs.writeFile(path.join(profileStateDir, "branch.json"), "{}");
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: path.join(home, ".branch-other"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: "default",
            BRANCH_STATE_DIR: defaultStateDir,
          },
          () => home,
        ),
      ).toBe(true);
    });
  });

  it.each([
    {
      platform: "darwin" as const,
      envKey: "BRANCH_LAUNCHD_LABEL",
      value: "ai.branch.gateway",
    },
    {
      platform: "linux" as const,
      envKey: "BRANCH_SYSTEMD_UNIT",
      value: "branch-gateway.service",
    },
    {
      platform: "win32" as const,
      envKey: "BRANCH_WINDOWS_TASK_NAME",
      value: "Branch Agent Gateway",
    },
  ])("rejects a named profile overriding $envKey on $platform", ({ platform, envKey, value }) => {
    const home = "/home/test";
    const stateDir = path.join(home, ".branch-work");
    expect(
      isDefaultInstallIdentity(
        {
          HOME: home,
          BRANCH_PROFILE: "work",
          BRANCH_STATE_DIR: stateDir,
          BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
          [envKey]: value,
        },
        () => home,
        platform,
      ),
    ).toBe(false);
  });

  it.each(["../escape", "work\\..\\escape", "."])(
    "rejects invalid profile %j even when its derived paths match",
    (profile) => {
      const home = "/home/test";
      const profileStateDir = path.join(home, `.branch-${profile}`);

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            BRANCH_PROFILE: profile,
            BRANCH_STATE_DIR: profileStateDir,
            BRANCH_CONFIG_PATH: path.join(profileStateDir, "branch.json"),
          },
          () => home,
        ),
      ).toBe(false);
    },
  );

  it.each(["gateway", "node"])(
    "rejects macOS profile %j because its LaunchAgent label is reserved",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ BRANCH_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ BRANCH_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it.each(["Main"])(
    "rejects mixed-case native service profile %j on case-insensitive platforms",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ BRANCH_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(resolveNativeServiceProfileConflict({ BRANCH_PROFILE: profile }, "win32")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ BRANCH_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it("keeps lowercase native service profiles byte-compatible", () => {
    expect(resolveNativeServiceProfileConflict({ BRANCH_PROFILE: "main" }, "darwin")).toBeNull();
    expect(resolveNativeServiceProfileConflict({ BRANCH_PROFILE: "main" }, "win32")).toBeNull();
  });
});

describe("oauth paths", () => {
  it("prefers BRANCH_OAUTH_DIR over BRANCH_STATE_DIR", () => {
    const env = {
      BRANCH_OAUTH_DIR: "/custom/oauth",
      BRANCH_STATE_DIR: "/custom/state",
    };

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from BRANCH_STATE_DIR when unset", () => {
    const env = {
      BRANCH_STATE_DIR: "/custom/state",
    };

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("gateway port resolution", () => {
  it("prefers numeric env values over config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { BRANCH_GATEWAY_PORT: "19001", BRANCH_PROFILE: "work" },
      ),
    ).toBe(19001);
    expect(resolveGatewayPort({ gateway: { port: 19002 } }, { BRANCH_PROFILE: "work" })).toBe(
      19002,
    );
  });

  it.each([
    { profile: "ct2", expected: 45696 },
    { profile: "p1402", expected: 55636 },
    { profile: "p2380", expected: 55636 },
  ])("derives the byte-exact profile port for $profile", ({ profile, expected }) => {
    const port = resolveGatewayPort({}, { BRANCH_PROFILE: profile });
    expect(port).toBe(expected);
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(60000);
  });

  it.each([undefined, "default", "Default", "../escape"])(
    "keeps the default port for profile %j",
    (profile) => {
      expect(resolveGatewayPort({}, { BRANCH_PROFILE: profile })).toBe(DEFAULT_GATEWAY_PORT);
    },
  );

  it("accepts Compose-style IPv4 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { BRANCH_GATEWAY_PORT: "127.0.0.1:18789" },
      ),
    ).toBe(18789);
  });

  it("accepts Compose-style IPv6 host publish values from env", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, { BRANCH_GATEWAY_PORT: "[::1]:28789" }),
    ).toBe(28789);
  });

  it("ignores the legacy env name and falls back to config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { CLAWDBOT_GATEWAY_PORT: "127.0.0.1:18789" },
      ),
    ).toBe(19002);
  });

  it("falls back to config when the Compose-style suffix is invalid", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19003 } },
        { BRANCH_GATEWAY_PORT: "127.0.0.1:not-a-port" },
      ),
    ).toBe(19003);
  });

  it("falls back to config when env ports exceed TCP bounds", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, { BRANCH_GATEWAY_PORT: "65536" }),
    ).toBe(19003);
    expect(
      resolveGatewayPort(
        { gateway: { port: 19004 } },
        { BRANCH_GATEWAY_PORT: "127.0.0.1:65536" },
      ),
    ).toBe(19004);
    expect(
      resolveGatewayPort({ gateway: { port: 19005 } }, { BRANCH_GATEWAY_PORT: "[::1]:65536" }),
    ).toBe(19005);
  });

  it("falls back when malformed IPv6 inputs do not provide an explicit port", () => {
    expect(resolveGatewayPort({ gateway: { port: 19003 } }, { BRANCH_GATEWAY_PORT: "::1" })).toBe(
      19003,
    );
    expect(resolveGatewayPort({}, { BRANCH_GATEWAY_PORT: "2001:db8::1" })).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });

  it("falls back to the default port when env is invalid and config is unset", () => {
    expect(resolveGatewayPort({}, { BRANCH_GATEWAY_PORT: "127.0.0.1:not-a-port" })).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("state + config path candidates", () => {
  function expectBranchHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.BRANCH_HOME;
    if (!configuredHome) {
      throw new Error("BRANCH_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".branch"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".branch", "branch.json"));
  }

  it("uses BRANCH_STATE_DIR when set", () => {
    const env = {
      BRANCH_STATE_DIR: "/new/state",
    };

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("pins a relative state-dir override before later resolution", () => {
    const env = {
      BRANCH_STATE_DIR: "relative-state",
      BRANCH_HOME: "/srv/branch-home",
    };

    normalizeStateDirEnv(env);
    const normalized = env.BRANCH_STATE_DIR;

    expect(normalized).toBe(path.resolve("relative-state"));
    expect(resolveStateDir(env, () => "/srv/other-home")).toBe(normalized);
  });

  it("re-pins exported runtime paths after startup environment selection", () => {
    const originalConfigPath = CONFIG_PATH;
    const originalNixMode = isNixMode;
    const originalStateDir = STATE_DIR;
    const selectedStateDir = path.resolve("/tmp/branch-selected-runtime-state");
    const selectedConfigPath = path.join(selectedStateDir, "selected.json");
    try {
      const pinned = pinRuntimePaths({
        BRANCH_CONFIG_PATH: selectedConfigPath,
        BRANCH_NIX_MODE: "1",
        BRANCH_STATE_DIR: selectedStateDir,
        BRANCH_TEST_FAST: "1",
      });

      expect(pinned).toEqual({
        configPath: selectedConfigPath,
        stateDir: selectedStateDir,
      });
      expect(CONFIG_PATH).toBe(selectedConfigPath);
      expect(isNixMode).toBe(true);
      expect(STATE_DIR).toBe(selectedStateDir);
    } finally {
      pinRuntimePaths({
        BRANCH_CONFIG_PATH: originalConfigPath,
        BRANCH_NIX_MODE: originalNixMode ? "1" : undefined,
        BRANCH_STATE_DIR: originalStateDir,
        BRANCH_TEST_FAST: "1",
      });
    }
  });

  it("prefers BRANCH_HOME over HOME for default state/config locations", () => {
    const env = {
      BRANCH_HOME: "/srv/branch-home",
      HOME: "/home/other",
    };
    expectBranchHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({}, () => home);
    const expected = [
      path.join(resolvedHome, ".branch", "branch.json"),
      path.join(resolvedHome, ".branch", "clawdbot.json"),
      path.join(resolvedHome, ".clawdbot", "branch.json"),
      path.join(resolvedHome, ".clawdbot", "clawdbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.branch when it exists and legacy dir is missing", async () => {
    await withTestDir({ prefix: "branch-state-" }, async (root) => {
      const newDir = path.join(root, ".branch");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({}, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("falls back to existing legacy state dir when ~/.branch is missing", async () => {
    await withTestDir({ prefix: "branch-state-legacy-" }, async (root) => {
      const legacyDir = path.join(root, ".clawdbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const resolved = resolveStateDir({}, () => root);
      expect(resolved).toBe(legacyDir);
    });
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    await withTestDir({ prefix: "branch-config-" }, async (root) => {
      const legacyDir = path.join(root, ".branch");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "branch.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({}, () => root);
      expect(resolved).toBe(legacyPath);
    });
  });

  it.each([
    { name: "candidate", resolve: resolveConfigPathCandidate },
    { name: "active", resolve: resolveConfigPath },
    { name: "canonical", resolve: resolveCanonicalConfigPath },
  ])("resolves explicit config selection in $name without filesystem discovery", ({ resolve }) => {
    const home = path.resolve("config-selection-home");
    const configPath = path.join(home, "selected.json");
    const exists = vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    try {
      expect(resolve({ HOME: home, BRANCH_CONFIG_PATH: configPath })).toBe(configPath);
      expect(exists).not.toHaveBeenCalled();
    } finally {
      exists.mockRestore();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    await withTestDir({ prefix: "branch-config-override-" }, async (root) => {
      const legacyDir = path.join(root, ".branch");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "branch.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { BRANCH_STATE_DIR: overrideDir };
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "branch.json"));
    });
  });
});

describe("resolveIncludeRoots", () => {
  const HOME = path.parse(process.cwd()).root + "fakehome";

  it("returns an empty list when BRANCH_INCLUDE_ROOTS is unset or blank", () => {
    expect(resolveIncludeRoots({}, () => HOME)).toStrictEqual([]);
    expect(resolveIncludeRoots({ BRANCH_INCLUDE_ROOTS: "" }, () => HOME)).toStrictEqual([]);
    expect(resolveIncludeRoots({ BRANCH_INCLUDE_ROOTS: "   " }, () => HOME)).toStrictEqual([]);
  });

  it("splits on the platform path delimiter and resolves each entry to an absolute path", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const b = path.resolve(path.parse(process.cwd()).root, "shared", "b");
    const env = { BRANCH_INCLUDE_ROOTS: [a, b].join(path.delimiter) };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a, b]);
  });

  it("expands a leading tilde in each entry using the resolved home dir", () => {
    const env = { BRANCH_INCLUDE_ROOTS: "~/share/branch" };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([path.join(HOME, "share", "branch")]);
  });

  it("drops empty entries and preserves de-duplicated order for repeated roots", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const env = {
      BRANCH_INCLUDE_ROOTS: ["", a, "  ", a].join(path.delimiter),
    };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a]);
  });
});
