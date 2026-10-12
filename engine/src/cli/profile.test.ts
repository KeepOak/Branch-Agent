import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayPort } from "../config/paths.js";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it.each([
    {
      args: ["--no-color", "gateway", "--dev", "--allow-unconfigured"],
      profile: null,
      remaining: ["--no-color", "gateway", "--dev", "--allow-unconfigured"],
    },
    { args: ["--dev", "gateway"], profile: "dev", remaining: ["gateway"] },
    { args: ["--profile", "work", "status"], profile: "work", remaining: ["status"] },
    {
      args: ["status", "--profile", "work", "--deep"],
      profile: "work",
      remaining: ["status", "--deep"],
    },
    {
      args: ["qa", "matrix", "--profile", "fast", "--fail-fast"],
      profile: null,
      remaining: ["qa", "matrix", "--profile", "fast", "--fail-fast"],
    },
    {
      args: ["--no-color", "qa", "matrix", "--profile=fast"],
      profile: null,
      remaining: ["--no-color", "qa", "matrix", "--profile=fast"],
    },
    {
      args: [
        "qa",
        "run",
        "--profile",
        "smoke-ci",
        "--category",
        "agent-runtime.agent-turn-execution",
      ],
      profile: "smoke-ci",
      remaining: ["qa", "run", "--category", "agent-runtime.agent-turn-execution"],
    },
    {
      args: ["qa", "run", "--profile=release", "--output", "qa-report.md"],
      profile: "release",
      remaining: ["qa", "run", "--output", "qa-report.md"],
    },
    {
      args: ["qa", "run", "--qa-profile", "smoke-ci", "--surface", "agent-runtime"],
      profile: null,
      remaining: ["qa", "run", "--qa-profile", "smoke-ci", "--surface", "agent-runtime"],
    },
    {
      args: ["--profile", "work", "qa", "matrix", "--fail-fast"],
      profile: "work",
      remaining: ["qa", "matrix", "--fail-fast"],
    },
    { args: ["status", "--dev"], profile: "dev", remaining: ["status"] },
  ])(
    "selects the root profile without consuming command-local flags: $args",
    ({ args, profile, remaining }) => {
      expect(parseCliProfileArgs(["node", "branch", ...args])).toEqual({
        ok: true,
        profile,
        argv: ["node", "branch", ...remaining],
      });
    },
  );

  it("rejects missing profile value", () => {
    expect(parseCliProfileArgs(["node", "branch", "--profile"]).ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "branch", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "branch", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    expect(parseCliProfileArgs(argv).ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".branch-dev");
    expect(env.BRANCH_PROFILE).toBe("dev");
    expect(env.BRANCH_STATE_DIR).toBe(expectedStateDir);
    expect(env.BRANCH_CONFIG_PATH).toBe(path.join(expectedStateDir, "branch.json"));
    expect(env.BRANCH_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "prod",
      BRANCH_STATE_DIR: "/custom",
      BRANCH_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.BRANCH_PROFILE).toBe("dev");
    expect(env.BRANCH_STATE_DIR).toBe("/custom");
    expect(env.BRANCH_GATEWAY_PORT).toBe("19099");
    expect(env.BRANCH_CONFIG_PATH).toBe(path.join("/custom", "branch.json"));
  });

  it.each([
    { name: "default service to named profile", inheritedProfile: undefined, selected: "work" },
    { name: "named service to different profile", inheritedProfile: "main", selected: "work" },
    { name: "named service to dev", inheritedProfile: "main", selected: "dev" },
  ])("replaces the complete service selector bundle: $name", ({ inheritedProfile, selected }) => {
    const inheritedStateDir = inheritedProfile
      ? `/home/peter/.branch-${inheritedProfile}`
      : "/home/peter/.branch";
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: inheritedProfile,
      BRANCH_STATE_DIR: inheritedStateDir,
      BRANCH_CONFIG_PATH: path.join(inheritedStateDir, "branch.json"),
      BRANCH_GATEWAY_PORT: "18789",
      BRANCH_LAUNCHD_LABEL: inheritedProfile
        ? `ai.branch.${inheritedProfile}`
        : "ai.branch.gateway",
      BRANCH_SYSTEMD_UNIT: inheritedProfile
        ? `branch-gateway-${inheritedProfile}.service`
        : "branch-gateway.service",
      BRANCH_WINDOWS_TASK_NAME: inheritedProfile
        ? `Branch Agent Gateway (${inheritedProfile})`
        : "Branch Agent Gateway",
      BRANCH_SERVICE_MARKER: "branch",
      BRANCH_SERVICE_KIND: "gateway",
    };

    applyCliProfileEnv({ profile: selected, env, homedir: () => "/home/peter" });

    expect(env.BRANCH_PROFILE).toBe(selected);
    expect(env.BRANCH_STATE_DIR).toBe(`/home/peter/.branch-${selected}`);
    expect(env.BRANCH_CONFIG_PATH).toBeUndefined();
    expect(env.BRANCH_GATEWAY_PORT).toBe(selected === "dev" ? "19001" : undefined);
    expect(env.BRANCH_LAUNCHD_LABEL).toBeUndefined();
    expect(env.BRANCH_SYSTEMD_UNIT).toBeUndefined();
    expect(env.BRANCH_WINDOWS_TASK_NAME).toBeUndefined();
  });

  it("lets selected config or profile derivation resolve the port after stale service removal", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "main",
      BRANCH_STATE_DIR: "/home/peter/.branch-main",
      BRANCH_CONFIG_PATH: "/home/peter/.branch-main/branch.json",
      BRANCH_GATEWAY_PORT: "18789",
      BRANCH_LAUNCHD_LABEL: "ai.branch.main",
      BRANCH_SYSTEMD_UNIT: "branch-gateway-main.service",
      BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway (main)",
      BRANCH_SERVICE_MARKER: "branch",
      BRANCH_SERVICE_KIND: "gateway",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(resolveGatewayPort({ gateway: { port: 21999 } }, env)).toBe(21999);
    expect(resolveGatewayPort(undefined, env)).not.toBe(18789);
  });

  it("supports legacy gateway services without a service kind", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "main",
      BRANCH_STATE_DIR: "/home/peter/.branch-main",
      BRANCH_CONFIG_PATH: "/home/peter/.branch-main/branch.json",
      BRANCH_GATEWAY_PORT: "18789",
      BRANCH_SERVICE_MARKER: "branch",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.BRANCH_CONFIG_PATH).toBeUndefined();
    expect(env.BRANCH_GATEWAY_PORT).toBeUndefined();
  });

  it("preserves node service selectors when selecting a CLI profile", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "main",
      BRANCH_STATE_DIR: "/home/peter/.branch-main",
      BRANCH_CONFIG_PATH: "/home/peter/.branch-main/branch.json",
      BRANCH_GATEWAY_PORT: "19999",
      BRANCH_LAUNCHD_LABEL: "ai.branch.node",
      BRANCH_SYSTEMD_UNIT: "branch-node.service",
      BRANCH_WINDOWS_TASK_NAME: "Branch Agent Node",
      BRANCH_SERVICE_MARKER: "branch",
      BRANCH_SERVICE_KIND: "node",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.BRANCH_GATEWAY_PORT).toBe("19999");
    expect(env.BRANCH_LAUNCHD_LABEL).toBe("ai.branch.node");
    expect(env.BRANCH_SYSTEMD_UNIT).toBe("branch-node.service");
    expect(env.BRANCH_WINDOWS_TASK_NAME).toBe("Branch Agent Node");
  });

  it.each([
    {
      name: "the default profile without a profile marker",
      inheritedProfile: undefined,
      inheritedStateDir: "/home/peter/.branch",
    },
    {
      name: "another named profile",
      inheritedProfile: "main",
      inheritedStateDir: "/home/peter/.branch-main",
    },
    {
      name: "a home-relative default state directory",
      inheritedProfile: undefined,
      inheritedStateDir: "~/.branch",
    },
  ])(
    "switches inherited canonical state from $name to the requested profile",
    ({ inheritedProfile, inheritedStateDir }) => {
      const env: Record<string, string | undefined> = {
        BRANCH_PROFILE: inheritedProfile,
        BRANCH_STATE_DIR: inheritedStateDir,
        BRANCH_CONFIG_PATH: path.join(inheritedStateDir, "branch.json"),
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      const expectedStateDir = path.join(path.resolve("/home/peter"), ".branch-work");
      expect(env.BRANCH_PROFILE).toBe("work");
      expect(env.BRANCH_STATE_DIR).toBe(expectedStateDir);
      expect(env.BRANCH_CONFIG_PATH).toBe(path.join(expectedStateDir, "branch.json"));
    },
  );

  it("preserves an explicit config outside inherited canonical profile state", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "main",
      BRANCH_STATE_DIR: "/home/peter/.branch-main",
      BRANCH_CONFIG_PATH: "/srv/branch/custom.json",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.BRANCH_STATE_DIR).toBe("/home/peter/.branch-work");
    expect(env.BRANCH_CONFIG_PATH).toBe("/srv/branch/custom.json");
  });

  it.each(["branch-gateway-main", "branch-gateway-main.service"])(
    "drops inherited canonical service identities when switching profiles (%s)",
    (systemdUnit) => {
      const env: Record<string, string | undefined> = {
        BRANCH_PROFILE: "main",
        BRANCH_STATE_DIR: "/home/peter/.branch-main",
        BRANCH_CONFIG_PATH: "/home/peter/.branch-main/branch.json",
        BRANCH_LAUNCHD_LABEL: "ai.branch.main",
        BRANCH_SYSTEMD_UNIT: systemdUnit,
        BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway (main)",
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      expect(env.BRANCH_LAUNCHD_LABEL).toBeUndefined();
      expect(env.BRANCH_SYSTEMD_UNIT).toBeUndefined();
      expect(env.BRANCH_WINDOWS_TASK_NAME).toBeUndefined();
    },
  );

  it("preserves explicit custom service identities when switching profiles", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "main",
      BRANCH_LAUNCHD_LABEL: "com.example.gateway",
      BRANCH_SYSTEMD_UNIT: "custom-gateway.service",
      BRANCH_WINDOWS_TASK_NAME: "Custom Gateway",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.BRANCH_LAUNCHD_LABEL).toBe("com.example.gateway");
    expect(env.BRANCH_SYSTEMD_UNIT).toBe("custom-gateway.service");
    expect(env.BRANCH_WINDOWS_TASK_NAME).toBe("Custom Gateway");
  });

  it.each([{ inheritedProfile: "Main", selectedProfile: "main" }])(
    "keeps case-distinct named profiles isolated ($inheritedProfile to $selectedProfile)",
    ({ inheritedProfile, selectedProfile }) => {
      const inheritedStateDir = `/home/peter/.branch-${inheritedProfile}`;
      const env: Record<string, string | undefined> = {
        BRANCH_PROFILE: inheritedProfile,
        BRANCH_STATE_DIR: inheritedStateDir,
        BRANCH_CONFIG_PATH: path.join(inheritedStateDir, "branch.json"),
      };

      applyCliProfileEnv({ profile: selectedProfile, env, homedir: () => "/home/peter" });

      const expectedStateDir = `/home/peter/.branch-${selectedProfile}`;
      expect(env.BRANCH_PROFILE).toBe(selectedProfile);
      expect(env.BRANCH_STATE_DIR).toBe(expectedStateDir);
      expect(env.BRANCH_CONFIG_PATH).toBe(path.join(expectedStateDir, "branch.json"));
    },
  );

  it("treats case variants of the default profile as the same canonical profile", () => {
    const stateDir = "/home/peter/.branch";
    const env: Record<string, string | undefined> = {
      BRANCH_PROFILE: "Default",
      BRANCH_STATE_DIR: stateDir,
      BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
    };

    applyCliProfileEnv({ profile: "default", env, homedir: () => "/home/peter" });

    expect(env.BRANCH_PROFILE).toBe("default");
    expect(env.BRANCH_STATE_DIR).toBe(stateDir);
    expect(env.BRANCH_CONFIG_PATH).toBe(path.join(stateDir, "branch.json"));
  });

  it.each([
    {
      name: "the default profile",
      inheritedProfile: undefined,
      inheritedConfigPath: "/home/peter/.branch/branch.json",
    },
    {
      name: "a home-relative named profile",
      inheritedProfile: "main",
      inheritedConfigPath: "~/.branch-main/branch.json",
    },
  ])(
    "switches an inherited $name config when the state directory is absent",
    ({ inheritedProfile, inheritedConfigPath }) => {
      const env: Record<string, string | undefined> = {
        BRANCH_PROFILE: inheritedProfile,
        BRANCH_CONFIG_PATH: inheritedConfigPath,
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      const expectedStateDir = "/home/peter/.branch-work";
      expect(env.BRANCH_PROFILE).toBe("work");
      expect(env.BRANCH_STATE_DIR).toBe(expectedStateDir);
      expect(env.BRANCH_CONFIG_PATH).toBe(path.join(expectedStateDir, "branch.json"));
    },
  );

  it("uses BRANCH_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      BRANCH_HOME: "/srv/branch-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/branch-home");
    expect(env.BRANCH_STATE_DIR).toBe(path.join(resolvedHome, ".branch-work"));
    expect(env.BRANCH_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".branch-work", "branch.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "branch doctor --fix",
      env: {},
      expected: "branch doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "branch doctor --fix",
      env: { BRANCH_PROFILE: "Default" },
      expected: "branch doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "branch doctor --fix",
      env: { BRANCH_PROFILE: "bad profile" },
      expected: "branch doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "branch --profile work doctor --fix",
      env: { BRANCH_PROFILE: "work" },
      expected: "branch --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "branch --dev doctor",
      env: { BRANCH_PROFILE: "dev" },
      expected: "branch --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("branch doctor --fix", { BRANCH_PROFILE: "  jbbranch  " })).toBe(
      "branch --profile jbbranch doctor --fix",
    );
  });

  it("handles command with no args after branch", () => {
    expect(formatCliCommand("branch", { BRANCH_PROFILE: "test" })).toBe(
      "branch --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm branch doctor", { BRANCH_PROFILE: "work" })).toBe(
      "pnpm branch --profile work doctor",
    );
  });

  it("ignores unsafe container hints", () => {
    expect(
      formatCliCommand("branch gateway status --deep", {
        BRANCH_CONTAINER_HINT: "demo; rm -rf /",
      }),
    ).toBe("branch gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("branch doctor", {
        BRANCH_CONTAINER_HINT: "demo",
        BRANCH_PROFILE: "work",
      }),
    ).toBe("branch --container demo doctor");
  });

  it.each([
    "branch update",
    "pnpm branch --profile work update --channel beta",
    "branch --profile=work update",
    "branch --log-level debug update",
    "branch --dev update",
    "branch --no-color --profile work --log-level=debug update",
    "branch --profile update update",
  ])("does not prepend --container to root update: %s", (command) => {
    expect(
      formatCliCommand(command, { BRANCH_CONTAINER_HINT: "demo", BRANCH_PROFILE: "work" }),
    ).toBe(command);
  });

  it.each([
    ["branch", "plugins update telegram"],
    ["pnpm branch", "plugins update telegram"],
    ["branch", "--profile work plugins update telegram"],
    ["branch", "--profile update plugins list"],
    ["branch", "config set action update"],
  ])("preserves the active container for non-root update: %s %s", (prefix, command) => {
    expect(
      formatCliCommand(`${prefix} ${command}`, {
        BRANCH_CONTAINER_HINT: "demo",
        BRANCH_PROFILE: "work",
      }),
    ).toBe(`${prefix} --container demo ${command}`);
  });
});
