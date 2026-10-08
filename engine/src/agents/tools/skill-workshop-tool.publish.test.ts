import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWorkspaceSkills } from "../../skills/loading/workspace-skill-loader.js";
import { getSkillsSnapshotVersion } from "../../skills/runtime/refresh-state.js";
import { resolveWorkshopSkillsDir } from "../../skills/workshop/skills-root.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createSkillWorkshopTool } from "./skill-workshop-tool.js";

let state: BranchTestState;
const name = "shared-procedure";
const content =
  "---\nname: shared-procedure\ndescription: A reusable procedure\n---\n# Procedure\n";

beforeEach(async () => {
  state = await createBranchTestState({ layout: "state-only", prefix: "branch-skill-publish-" });
  await fs.mkdir(state.path("trunk-b-workspace"));
});

afterEach(async () => {
  await state.cleanup();
});

async function seedSkill(directory: string, body = content) {
  await fs.mkdir(path.join(directory, "scripts"), { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), body);
  await fs.writeFile(path.join(directory, "scripts", "helper.mjs"), "export const value = 1;\n");
}

function tool(agentId = "trunk-a", proposalOnly = false) {
  return createSkillWorkshopTool({
    workspaceDir: state.workspaceDir,
    config: {},
    env: state.env,
    agentId,
    proposalOnly,
  });
}

function listedForTrunkB() {
  return loadWorkspaceSkills(state.path("trunk-b-workspace"), {
    config: {},
    agentId: "trunk-b",
    managedSkillsDir: state.statePath("skills"),
    bundledSkillsDir: state.path("empty-bundled"),
  }).find((entry) => entry.skill.name === name);
}

describe("skill_workshop publish", () => {
  it("lists Trunk A's published skill for Trunk B on its next discovery", async () => {
    const source = path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name);
    await seedSkill(source);
    expect(listedForTrunkB()).toBeUndefined();
    const beforeVersion = getSkillsSnapshotVersion(state.path("trunk-b-workspace"));

    const result = await tool().execute("publish", { action: "publish", name });

    expect(result.details).toMatchObject({ skillName: name, published: true });
    expect(getSkillsSnapshotVersion(state.path("trunk-b-workspace"))).toBeGreaterThan(
      beforeVersion,
    );
    expect(listedForTrunkB()).toMatchObject({ skill: { source: "branch-managed" } });
    const destination = state.statePath("skills", name);
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe(content);
    expect(await fs.readFile(path.join(destination, "scripts", "helper.mjs"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    await fs.writeFile(path.join(source, "scripts", "helper.mjs"), "changed\n");
    expect(await fs.readFile(path.join(destination, "scripts", "helper.mjs"), "utf8")).toBe(
      "export const value = 1;\n",
    );
  });

  it("refuses a name clash with a reason and preserves the shared skill", async () => {
    await seedSkill(path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name));
    const destination = state.statePath("skills", "another-directory");
    const otherContent = `${content}\nDifferent procedure.\n`;
    await seedSkill(destination, otherContent);

    await expect(tool().execute("publish", { action: "publish", name })).rejects.toThrow(
      "a different skill with that name already exists in the shared library",
    );
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe(otherContent);
    await expect(fs.stat(state.statePath("skills", name))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("treats identical publication as a no-op", async () => {
    await seedSkill(path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name));
    await tool().execute("first", { action: "publish", name });
    expect((await tool().execute("again", { action: "publish", name })).details).toMatchObject({
      skillName: name,
      published: false,
    });
  });

  it("refuses different supporting files even when SKILL.md is identical", async () => {
    await seedSkill(path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name));
    const destination = state.statePath("skills", name);
    await seedSkill(destination);
    await fs.writeFile(path.join(destination, "scripts", "helper.mjs"), "different\n");
    await expect(tool().execute("publish", { action: "publish", name })).rejects.toThrow(
      "a different skill with that name already exists in the shared library",
    );
    expect(await fs.readFile(path.join(destination, "scripts", "helper.mjs"), "utf8")).toBe(
      "different\n",
    );
  });

  it("does not overwrite an occupied destination with a different manifest name", async () => {
    await seedSkill(path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name));
    const destination = state.statePath("skills", name);
    const otherContent = content.replace("name: shared-procedure", "name: other-procedure");
    await seedSkill(destination, otherContent);
    await expect(tool().execute("publish", { action: "publish", name })).rejects.toThrow(
      "a different skill with that name already exists in the shared library",
    );
    expect(await fs.readFile(path.join(destination, "SKILL.md"), "utf8")).toBe(otherContent);
  });

  it("restricts publication to the active Trunk's Workshop skills", async () => {
    await seedSkill(path.join(resolveWorkshopSkillsDir({}, "trunk-a", state.env), name));
    await expect(tool("trunk-b").execute("publish", { action: "publish", name })).rejects.toThrow(
      "No Workshop-generated skill matched",
    );
    await expect(
      tool("trunk-a", true).execute("publish", { action: "publish", name }),
    ).rejects.toThrow("this Skill Workshop review allows only");
    await expect(fs.stat(state.statePath("skills", name))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
