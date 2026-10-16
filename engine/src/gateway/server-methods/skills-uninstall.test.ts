// skills.uninstall removes only tracked Seedbank installs and refuses bundled, custodian, untracked,
// modified, or unreviewed skills.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { digestClawHubSkillTree } from "../../skills/lifecycle/skill-tree-digest.js";
import { closeSkillsWatchers } from "../../skills/runtime/refresh.js";
import { callGatewayHandler } from "./skills.test-helpers.js";

type StatusSkill = { name: string; skillKey: string; source: string };

const statusSkillsMock = vi.fn<() => StatusSkill[]>(() => []);
const resolveAgentWorkspaceDirMock = vi.fn<(_cfg: unknown, _agentId: string) => string>();

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
  resolveAgentConfig: vi.fn(() => undefined),
  resolveDefaultAgentId: () => "main",
  resolveAgentWorkspaceDir: (cfg: unknown, agentId: string) =>
    resolveAgentWorkspaceDirMock(cfg, agentId),
  resolveSessionAgentId: vi.fn(() => undefined),
}));

vi.mock("../../skills/discovery/status.js", () => ({
  prepareWorkspaceSkillStatus: async () => ({
    report: { workspaceDir: "", managedSkillsDir: "", skills: statusSkillsMock() },
    files: [],
  }),
}));

// Unit tests must not open remote node connections; the source check only needs local entries.
vi.mock("../../skills/runtime/remote-skills.js", () => ({
  prepareRemoteSkillConnections: async () => undefined,
}));

vi.mock("../../skills/runtime/remote.js", () => ({
  getRemoteSkillEligibility: () => undefined,
}));

const { skillsHandlers } = await import("./skills.js");

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(async () => {
  await closeSkillsWatchers(true);
});
const SLUG = "triage";
const VERSION = "1.0.0";
const SKILL_MD = "---\nname: triage\ndescription: Triage incidents\nversion: 0.9.0\n---\n";
const REGISTRY = "https://clawhub.ai";

async function callUninstall(params: Record<string, unknown>) {
  return callGatewayHandler(skillsHandlers, "skills.uninstall", params);
}

/** Writes a Seedbank install with real fingerprints, mirroring what the install path records. */
async function writeTrackedInstall(workspaceDir: string, slug = SLUG): Promise<string> {
  const skillDir = join(workspaceDir, "skills", slug);
  const sha256 = createHash("sha256").update(SKILL_MD).digest("hex");
  await fs.mkdir(join(skillDir, ".clawhub"), { recursive: true });
  await fs.mkdir(join(workspaceDir, ".clawhub"), { recursive: true });
  await fs.writeFile(join(skillDir, "SKILL.md"), SKILL_MD);
  const fileTreeSha256 = await digestClawHubSkillTree(skillDir);
  const tracking = {
    version: 1,
    registry: REGISTRY,
    slug,
    installedVersion: VERSION,
    installedAt: 123,
    ownerHandle: "owner",
    skillFile: { path: "SKILL.md", sha256 },
    fileTreeSha256,
  };
  await fs.writeFile(join(skillDir, ".clawhub", "origin.json"), JSON.stringify(tracking));
  await fs.writeFile(
    join(workspaceDir, ".clawhub", "lock.json"),
    JSON.stringify({
      version: 1,
      skills: {
        [slug]: {
          version: VERSION,
          registry: REGISTRY,
          installedAt: 123,
          ownerHandle: "owner",
          skillFile: { path: "SKILL.md", sha256 },
          fileTreeSha256,
        },
      },
    }),
  );
  return skillDir;
}

async function exists(path: string): Promise<boolean> {
  return fs.access(path).then(
    () => true,
    () => false,
  );
}

describe("skills.uninstall gateway handler", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = tempDirs.make("branch-skills-uninstall-handler-");
    resolveAgentWorkspaceDirMock.mockReset();
    resolveAgentWorkspaceDirMock.mockReturnValue(workspaceDir);
    statusSkillsMock.mockReset();
    statusSkillsMock.mockReturnValue([]);
  });

  it("removes a tracked Seedbank skill when expectedVersion matches", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);

    const { ok, response, error } = await callUninstall({ slug: SLUG, expectedVersion: VERSION });

    expect(error).toBeUndefined();
    expect(ok).toBe(true);
    expect(response).toMatchObject({ ok: true, slug: SLUG, version: VERSION });
    expect(await exists(skillDir)).toBe(false);
    const lock = JSON.parse(await fs.readFile(join(workspaceDir, ".clawhub", "lock.json"), "utf8"));
    expect(lock.skills[SLUG]).toBeUndefined();
  });

  it("refuses a bundled skill even when a workspace directory with that slug exists", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);
    statusSkillsMock.mockReturnValue([
      { name: SLUG, skillKey: SLUG, source: "branch-bundled" },
    ]);

    const { ok, error } = await callUninstall({ slug: SLUG, expectedVersion: VERSION });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("branch-bundled skill"),
    });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("refuses a custodian skill", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);
    statusSkillsMock.mockReturnValue([
      { name: SLUG, skillKey: SLUG, source: "branch-custodian" },
    ]);

    const { ok, error } = await callUninstall({ slug: SLUG, expectedVersion: VERSION });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      code: "INVALID_REQUEST",
      message: expect.stringContaining("branch-custodian skill"),
    });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("refuses an untracked slug with the plan's missing code", async () => {
    const skillDir = join(workspaceDir, "skills", "handmade");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(join(skillDir, "SKILL.md"), SKILL_MD);

    const { ok, error } = await callUninstall({ slug: "handmade", expectedVersion: VERSION });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("is not a tracked Seedbank install"),
      details: { code: "missing" },
    });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("refuses a tracked skill with local SKILL.md edits", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);
    await fs.writeFile(join(skillDir, "SKILL.md"), `${SKILL_MD}Local edit.\n`);

    const { ok, error } = await callUninstall({ slug: SLUG, expectedVersion: VERSION });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      code: "UNAVAILABLE",
      message: expect.stringContaining("has local SKILL.md changes"),
      details: { code: "modified" },
    });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("refuses when expectedVersion does not match the installed version", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);

    const { ok, error } = await callUninstall({ slug: SLUG, expectedVersion: "9.9.9" });

    expect(ok).toBe(false);
    expect(error).toMatchObject({
      message: expect.stringContaining("expected 9.9.9"),
      details: { code: "modified" },
    });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  it("fails validation when expectedVersion is missing", async () => {
    const skillDir = await writeTrackedInstall(workspaceDir);

    const { ok, error } = await callUninstall({ slug: SLUG });

    expect(ok).toBe(false);
    expect(error).toMatchObject({ code: "INVALID_REQUEST" });
    expect(await exists(join(skillDir, "SKILL.md"))).toBe(true);
  });
});
