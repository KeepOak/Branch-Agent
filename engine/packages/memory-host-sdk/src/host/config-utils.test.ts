import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeConfiguredMemoryExtraPaths,
  resolveMemoryHostAgentWorkspaceDir,
  resolveRememberAcrossConversations,
  type BranchConfig,
} from "./config-utils.js";

describe("resolveMemoryHostAgentWorkspaceDir", () => {
  it.each([
    { name: "profile alone", stateDir: undefined },
    { name: "explicit profile state directory", stateDir: "/home/fixture/.branch-work" },
  ])("uses the active profile workspace with $name", ({ stateDir }) => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/fixture",
        BRANCH_PROFILE: "work",
        BRANCH_STATE_DIR: stateDir,
      }),
    ).toBe(path.resolve("/home/fixture/.branch-work/workspace"));
  });

  it("keeps the default agent workspace inside an overridden state directory", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/peter",
        BRANCH_STATE_DIR: "/srv/branch-scratch",
      }),
    ).toBe("/srv/branch-scratch/workspace");
  });

  it("prefers an explicit workspace override to the state directory", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/peter",
        BRANCH_STATE_DIR: "/srv/branch-scratch",
        BRANCH_WORKSPACE_DIR: "/srv/branch-workspace",
      }),
    ).toBe("/srv/branch-workspace");
  });

  it("keeps literal $ patterns in home when expanding tilde workspace paths", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir(
        { agents: { entries: { support: { workspace: "~/ws" } } } },
        "support",
        { HOME: "/home/peter$&mall", BRANCH_HOME: "~/oc" },
      ),
    ).toBe(path.resolve("/home/peter$&mall/oc/ws"));
  });

  it.each([
    {
      name: "tilde state root",
      stateDir: "~/state",
      workspaceDir: undefined,
      expected: "state/workspace",
    },
    {
      name: "tilde workspace override",
      stateDir: "~/state",
      workspaceDir: "~/workspace",
      expected: "workspace",
    },
  ])("expands the $name against BRANCH_HOME", ({ stateDir, workspaceDir, expected }) => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/fixture",
        BRANCH_HOME: "~/branch-home",
        BRANCH_STATE_DIR: stateDir,
        BRANCH_WORKSPACE_DIR: workspaceDir,
      }),
    ).toBe(path.resolve("/home/fixture/branch-home", expected));
  });

  it.each([
    { name: "default workspace", workspace: undefined, expected: ".branch/workspace" },
    { name: "configured workspace", workspace: "~/notes", expected: "notes" },
  ])("uses the Termux home for the $name when HOME is unavailable", ({ workspace, expected }) => {
    const homedir = vi.spyOn(os, "homedir").mockReturnValue("/unexpected/os/home");
    try {
      expect(
        resolveMemoryHostAgentWorkspaceDir(
          { agents: { entries: { main: { workspace } } } },
          "main",
          {
            HOME: "undefined",
            USERPROFILE: "null",
            PREFIX: "/data/data/com.termux/files/usr",
            ANDROID_DATA: "/data",
          },
        ),
      ).toBe(path.resolve("/data/data/com.termux/files/home", expected));
    } finally {
      homedir.mockRestore();
    }
  });

  it.each([
    { agentId: "main", stateDir: undefined, expected: ".branch/workspace" },
    { agentId: "support", stateDir: undefined, expected: ".branch/workspace-support" },
    { agentId: "main", stateDir: "~/state", expected: "state/workspace" },
    { agentId: "support", stateDir: "~/state", expected: "state/workspace-support" },
  ])(
    "expands the OS fallback home once for $agentId with state override $stateDir",
    ({ agentId, stateDir, expected }) => {
      const homedir = vi.spyOn(os, "homedir").mockReturnValue("/home/fixture");
      try {
        expect(
          resolveMemoryHostAgentWorkspaceDir(
            { agents: { entries: { main: {}, support: {} } } },
            agentId,
            {
              BRANCH_HOME: "~/oc",
              BRANCH_STATE_DIR: stateDir,
              VITEST: "1",
              BRANCH_TEST_FAST: "1",
            },
          ),
        ).toBe(path.resolve("/home/fixture/oc", expected));
      } finally {
        homedir.mockRestore();
      }
    },
  );

  it.each([
    { agentId: "main", override: "state", leaf: "workspace" },
    { agentId: "support", override: "state", leaf: "workspace-support" },
    { agentId: "main", override: "workspace", leaf: "" },
  ])(
    "resolves the absolute $override override for $agentId without home or cwd",
    ({ agentId, override, leaf }) => {
      const absolute = path.resolve("/srv/fixture-override");
      const expected = path.join(absolute, leaf);
      const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
        throw new Error("fixture home unavailable");
      });
      const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
        throw new Error("ENOENT: fixture cwd unavailable");
      });
      try {
        expect(
          resolveMemoryHostAgentWorkspaceDir(
            { agents: { entries: { main: {}, support: {} } } },
            agentId,
            {
              BRANCH_HOME: "~/oc",
              BRANCH_STATE_DIR: override === "state" ? absolute : "~/state",
              BRANCH_WORKSPACE_DIR: override === "workspace" ? absolute : undefined,
            },
          ),
        ).toBe(expected);
      } finally {
        cwd.mockRestore();
        homedir.mockRestore();
      }
    },
  );

  it("falls back to cwd when no home source is available", () => {
    const expected = path.join(process.cwd(), ".branch", "workspace");
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("fixture home unavailable");
    });
    try {
      expect(resolveMemoryHostAgentWorkspaceDir({}, "main", {})).toBe(expected);
    } finally {
      homedir.mockRestore();
    }
  });

  it("explains how to recover when both home and cwd are unavailable", () => {
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("fixture home unavailable");
    });
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("ENOENT: fixture cwd unavailable");
    });
    try {
      expect(() => resolveMemoryHostAgentWorkspaceDir({}, "main", {})).toThrow(
        "Unable to resolve a Branch Agent home: set BRANCH_HOME, HOME, or USERPROFILE",
      );
    } finally {
      cwd.mockRestore();
      homedir.mockRestore();
    }
  });

  it("preserves legacy state precedence for secondary agents without moving the default workspace", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "memory-host-state-"));
    const cfg: BranchConfig = { agents: { entries: { main: {}, support: {} } } };
    const env = { HOME: home };
    const legacy = path.join(home, ".clawdbot");
    const current = path.join(home, ".branch");
    try {
      await fs.mkdir(legacy);
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "support", env)).toBe(
        path.join(legacy, "workspace-support"),
      );
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main", env)).toBe(
        path.join(current, "workspace"),
      );
      expect(
        resolveMemoryHostAgentWorkspaceDir(cfg, "support", {
          ...env,
          VITEST: "1",
          BRANCH_TEST_FAST: "1",
        }),
      ).toBe(path.join(current, "workspace-support"));
      await fs.mkdir(current);
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "support", env)).toBe(
        path.join(current, "workspace-support"),
      );
      expect(
        resolveMemoryHostAgentWorkspaceDir(cfg, "support", {
          ...env,
          BRANCH_STATE_DIR: path.join(home, "override"),
        }),
      ).toBe(path.join(home, "override", "workspace-support"));
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it.each<{
    name: string;
    agents: NonNullable<BranchConfig["agents"]>;
    expected: Record<string, string>;
  }>([
    {
      name: "keyed first-agent inheritance",
      agents: { entries: { main: {}, support: {} } },
      expected: { main: "shared", support: "shared/support" },
    },
    {
      name: "marked legacy default",
      agents: { list: [{ id: "first" }, { id: "support", default: true }] },
      expected: { first: "shared/first", support: "shared" },
    },
    {
      name: "optional legacy list id and explicit workspace",
      agents: { list: [{ workspace: "~/anonymous" }, { id: "support" }] },
      expected: { main: "anonymous", support: "shared/support" },
    },
  ])("preserves $name", ({ agents, expected }) => {
    const cfg: BranchConfig = {
      agents: { ...agents, defaults: { workspace: "~/shared" } },
    };
    for (const [agentId, relativePath] of Object.entries(expected)) {
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, agentId, { HOME: "/home/fixture" })).toBe(
        path.resolve("/home/fixture", relativePath),
      );
    }
  });
});

describe("resolveRememberAcrossConversations", () => {
  it("honors keyed per-agent memory overrides", () => {
    const config = {
      memory: { search: { rememberAcrossConversations: true } },
      agents: {
        entries: {
          support: { memory: { search: { rememberAcrossConversations: false } } },
        },
      },
    };

    expect(resolveRememberAcrossConversations(config, "support")).toBe(false);
  });
});

describe("normalizeConfiguredMemoryExtraPaths", () => {
  it("preserves distinct patterns and canonicalizes unpatterned objects", () => {
    expect(
      normalizeConfiguredMemoryExtraPaths([
        " notes ",
        { path: "notes" },
        { path: " notes ", pattern: " runbooks/**/*.md " },
        { path: "notes", pattern: "runbooks/**/*.md" },
        { path: "notes", pattern: "decisions/**/*.md" },
      ]),
    ).toEqual([
      "notes",
      { path: "notes", pattern: "runbooks/**/*.md" },
      { path: "notes", pattern: "decisions/**/*.md" },
    ]);
  });
});
