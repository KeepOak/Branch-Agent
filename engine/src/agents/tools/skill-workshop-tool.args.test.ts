// skill_workshop argument and run-usage regressions from transcript failures:
// a symlinked state folder, and `name` sent where `skill_name` is expected.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consumeRunSkillUsage, recordRunSkillUsage } from "../../skills/runtime/run-usage.js";
import { resolveWorkshopSkillsDir } from "../../skills/workshop/skills-root.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { createSkillWorkshopTool } from "./skill-workshop-tool.js";

const tempDirs = createTrackedTempDirs();
let testState: BranchTestState;

beforeEach(async () => {
  testState = await createBranchTestState({
    layout: "state-only",
    prefix: "branch-skill-workshop-args-",
  });
});

afterEach(async () => {
  await testState.cleanup();
  await tempDirs.cleanup();
});

async function createAppliedSkill(
  tool: ReturnType<typeof createSkillWorkshopTool>,
  name: string,
  body: string,
) {
  const created = await tool.execute("create", {
    action: "create",
    name,
    description: "Exercise skill_workshop arguments",
    proposal_content: body,
  });
  await tool.execute("apply", {
    action: "apply",
    proposal_id: (created.details as { id: string }).id,
  });
}

describe("skill_workshop run usage", () => {
  it("patches a skill read in this run when the skills folder is a symlink", async () => {
    const env = testState.env;
    const skillsDir = resolveWorkshopSkillsDir({}, "main", env);
    const realSkillsDir = await tempDirs.make("branch-skill-workshop-real-skills-");
    await fs.mkdir(path.dirname(skillsDir), { recursive: true });
    await fs.symlink(realSkillsDir, skillsDir, process.platform === "win32" ? "junction" : "dir");
    expect(await fs.realpath(skillsDir)).not.toBe(skillsDir);

    const runId = "symlinked-state-repair";
    const skillName = "symlinked-skill";
    const tool = createSkillWorkshopTool({
      workspaceDir: testState.workspaceDir,
      config: { skills: { workshop: { autonomous: { mode: "auto" } } } },
      env,
      agentId: "main",
      origin: { agentId: "main", runId },
    });
    await createAppliedSkill(tool, skillName, "# Symlinked\n\nUse OLD_TOKEN.\n");
    const skillFile = path.join(skillsDir, skillName, "SKILL.md");
    // The tool-call recorder stores the canonical (realpath) skill file.
    recordRunSkillUsage({
      runId,
      name: skillName,
      source: "workspace",
      activation: "read",
      skillFile: await fs.realpath(skillFile),
    });
    await tool.execute("read", { action: "read", skill_name: skillName });

    try {
      await expect(
        tool.execute("patch", {
          action: "patch",
          skill_name: skillName,
          old_string: "Use OLD_TOKEN.",
          new_string: "Use NEW_TOKEN.",
        }),
      ).resolves.toMatchObject({ details: { status: "applied" } });
      await expect(fs.readFile(skillFile, "utf8")).resolves.toContain("Use NEW_TOKEN.");
    } finally {
      consumeRunSkillUsage(runId);
    }
  });
});

describe("skill_workshop skill_name argument", () => {
  it("accepts name as skill_name for read and patch and says so", async () => {
    const runId = "name-alias";
    const skillName = "alias-skill";
    const tool = createSkillWorkshopTool({
      workspaceDir: testState.workspaceDir,
      config: { skills: { workshop: { autonomous: { mode: "auto" } } } },
      env: testState.env,
      agentId: "main",
      origin: { agentId: "main", runId },
    });
    await createAppliedSkill(tool, skillName, "# Alias\n\nUse OLD_TOKEN.\n");
    const skillFile = path.join(
      resolveWorkshopSkillsDir({}, "main", testState.env),
      skillName,
      "SKILL.md",
    );
    recordRunSkillUsage({
      runId,
      name: skillName,
      source: "workspace",
      activation: "read",
      skillFile,
    });

    try {
      const read = await tool.execute("read", { action: "read", name: skillName });
      expect(read.details).toMatchObject({
        skillName,
        argumentNote: expect.stringContaining('Used name "alias-skill" as skill_name'),
      });
      expect(read.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("action=read takes skill_name"),
      });

      const patch = await tool.execute("patch", {
        action: "patch",
        name: skillName,
        old_string: "Use OLD_TOKEN.",
        new_string: "Use NEW_TOKEN.",
      });
      expect(patch.details).toMatchObject({
        status: "applied",
        argumentNote: expect.stringContaining("action=patch"),
      });
      await expect(fs.readFile(skillFile, "utf8")).resolves.toContain("Use NEW_TOKEN.");
    } finally {
      consumeRunSkillUsage(runId);
    }
  });

  it("names the action and shows an example when skill_name is missing", async () => {
    const tool = createSkillWorkshopTool({
      workspaceDir: testState.workspaceDir,
      config: {},
      env: testState.env,
      agentId: "main",
    });

    await expect(
      tool.execute("prepare", { action: "prepare_patch", old_string: "anything" }),
    ).rejects.toThrow(
      'skill_name required for action=prepare_patch: pass the Workshop skill name, for example { action: "prepare_patch", skill_name: "my-skill", old_string: "exact current text" }',
    );
  });

  it("keeps name for create", async () => {
    const tool = createSkillWorkshopTool({
      workspaceDir: testState.workspaceDir,
      config: {},
      env: testState.env,
      agentId: "main",
    });
    const created = await tool.execute("create", {
      action: "create",
      name: "create-keeps-name",
      description: "Create still uses name",
      proposal_content: "# Create\n\nBody.\n",
    });
    expect(created.details).not.toHaveProperty("argumentNote");
  });
});
