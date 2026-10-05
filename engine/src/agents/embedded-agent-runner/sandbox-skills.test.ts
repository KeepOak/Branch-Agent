// Sandbox skill input tests cover snapshot suppression and synced skill workspace selection.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recordExplicitSkillSelectionFileHost } from "../../skills/discovery/skill-command-provenance.js";
import { createSyntheticSourceInfo } from "../../skills/loading/skill-contract.js";
import { resolveSkillsPrompt } from "../../skills/loading/workspace-skill-prompt.js";
import { resolveEmbeddedRunSkillEntries } from "../../skills/runtime/embedded-run-entries.js";
import { recordSkillFileHost, resolveSkillFileHost } from "../../skills/skill-file-host.js";
import type { SkillSnapshot } from "../../skills/types.js";
import {
  mapSandboxSkillEntriesForPrompt,
  remapExplicitSkillSelectionPath,
  remapSkillReferencePaths,
  resolveSandboxSkillRuntimeInputs,
} from "./sandbox-skills.js";

const hostSkillPath = "/usr/lib/node_modules/branch/skills/demo/SKILL.md";
const hostSkillBaseDir = "/usr/lib/node_modules/branch/skills/demo";
const workspaceSkill = recordSkillFileHost(
  {
    name: "demo",
    description: "Demo skill",
    filePath: hostSkillPath,
    baseDir: hostSkillBaseDir,
    source: "branch-bundled",
    sourceInfo: createSyntheticSourceInfo(hostSkillPath, {
      source: "branch-bundled",
      baseDir: hostSkillBaseDir,
    }),
    disableModelInvocation: false,
  },
  "workspace",
);
const snapshot: SkillSnapshot = {
  prompt:
    "<available_skills><skill><location>/usr/lib/node_modules/branch/skills/demo/SKILL.md</location></skill></available_skills>",
  skills: [{ name: "demo" }],
  resolvedSkills: [workspaceSkill],
  discoverySkills: [workspaceSkill],
};

describe("resolveSandboxSkillRuntimeInputs", () => {
  it("keeps snapshots for non-sandboxed runs", () => {
    expect(
      resolveSandboxSkillRuntimeInputs({
        skillsAnchorWorkspace: "/workspace",
        skillsSnapshot: snapshot,
      }),
    ).toEqual({
      skillsSnapshot: snapshot,
      skillsPromptWorkspaceDir: "/workspace",
      skillsWorkspaceDir: "/workspace",
      workspaceOnly: false,
    });
  });

  it("uses the skills anchor for sandbox contexts without materialized skills", () => {
    expect(
      resolveSandboxSkillRuntimeInputs({
        sandbox: { enabled: true },
        skillsAnchorWorkspace: "/workspace",
        skillsSnapshot: snapshot,
      }),
    ).toEqual({
      skillsSnapshot: undefined,
      skillsPromptWorkspaceDir: "/workspace",
      skillsWorkspaceDir: "/workspace",
      workspaceOnly: true,
    });
  });

  it("maps materialized read paths while preserving original file identities", () => {
    expect(
      resolveSandboxSkillRuntimeInputs({
        sandbox: {
          enabled: true,
          workspaceAccess: "rw",
          containerWorkdir: "/workspace",
          skillsWorkspaceDir: "/state/sandbox-skills",
          skillUsagePaths: [
            {
              readPath: "/state/sandbox-skills/skills/demo/SKILL.md",
              skillFile: "/agent-workspace/skills/demo/SKILL.md",
              skillName: "demo",
              skillSource: "workspace",
            },
          ],
        },
        skillsAnchorWorkspace: "/workspace",
      }).skillUsagePaths,
    ).toEqual([
      {
        readPath: "/workspace/.branch/sandbox-skills/skills/demo/SKILL.md",
        skillFile: "/agent-workspace/skills/demo/SKILL.md",
        skillName: "demo",
        skillSource: "workspace",
      },
    ]);
  });

  it("remaps workspace-hosted explicit references to the delivered sandbox copy", () => {
    const hiddenSkillPath = "/host/skills/hidden/SKILL.md";
    const gatewaySkill = recordSkillFileHost(
      { ...workspaceSkill, name: "gateway-demo" },
      "gateway",
    );
    const runtime = resolveSandboxSkillRuntimeInputs({
      sandbox: {
        enabled: true,
        workspaceAccess: "rw",
        containerWorkdir: "/workspace",
        skillsWorkspaceDir: "/state/sandbox-skills",
        skillUsagePaths: [
          {
            readPath: "/state/sandbox-skills/skills/demo/SKILL.md",
            skillFile: hostSkillPath,
            skillName: "demo",
            skillSource: "workspace",
          },
          {
            readPath: "/state/sandbox-skills/skills/gateway-demo/SKILL.md",
            skillFile: hostSkillPath,
            skillName: "gateway-demo",
            skillSource: "workspace",
          },
          {
            readPath: "/state/sandbox-skills/skills/hidden/SKILL.md",
            skillFile: hiddenSkillPath,
            skillName: "hidden",
            skillSource: "workspace",
          },
        ],
      },
      skillsAnchorWorkspace: "/workspace",
      skillsSnapshot: {
        ...snapshot,
        skills: [...snapshot.skills, { name: "hidden" }],
        resolvedSkills: [workspaceSkill, gatewaySkill],
      },
    });

    expect(
      remapSkillReferencePaths(
        `Read workspace-skill://workspace/demo/SKILL.md, ${hostSkillPath}, ` +
          `workspace-skill://workspace/hidden/SKILL.md, ` +
          "workspace-skill://workspace/hidden/references/setup.md, " +
          `${hiddenSkillPath}, and /host/skills/hidden/references/setup.md before acting.`,
        runtime.skillUsagePaths,
      ),
    ).toBe(
      "Read /workspace/.branch/sandbox-skills/skills/demo/SKILL.md, " +
        "/workspace/.branch/sandbox-skills/skills/gateway-demo/SKILL.md, " +
        "/workspace/.branch/sandbox-skills/skills/hidden/SKILL.md, " +
        "/workspace/.branch/sandbox-skills/skills/hidden/references/setup.md, " +
        "/workspace/.branch/sandbox-skills/skills/hidden/SKILL.md, and " +
        "/workspace/.branch/sandbox-skills/skills/hidden/references/setup.md before acting.",
    );
    expect(
      remapExplicitSkillSelectionPath(
        recordExplicitSkillSelectionFileHost({ name: "demo-2", path: hostSkillPath }, "workspace"),
        runtime.skillUsagePaths,
      ),
    ).toBe("/workspace/.branch/sandbox-skills/skills/demo/SKILL.md");
    expect(
      remapExplicitSkillSelectionPath(
        recordExplicitSkillSelectionFileHost(
          { name: "gateway-demo", path: hostSkillPath },
          "gateway",
        ),
        runtime.skillUsagePaths,
      ),
    ).toBe("/workspace/.branch/sandbox-skills/skills/gateway-demo/SKILL.md");
    expect(
      remapExplicitSkillSelectionPath(
        recordExplicitSkillSelectionFileHost(
          { name: "hidden-2", path: hiddenSkillPath },
          "workspace",
        ),
        runtime.skillUsagePaths,
      ),
    ).toBe("/workspace/.branch/sandbox-skills/skills/hidden/SKILL.md");
  });

  it.each([
    { label: "rebuilds sandbox prompts from materialized skill paths", skillsSnapshot: snapshot },
    {
      label: "keeps audited skills out of an explicitly empty sandbox snapshot",
      skillsSnapshot: { prompt: "", skills: [] },
    },
  ])("$label", async ({ skillsSnapshot }) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "branch-sandbox-skills-"));
    try {
      const effectiveWorkspace = path.join(root, "workspace");
      const materializedWorkspace = path.join(root, "state", "sandbox-skills");
      const skillDir = path.join(materializedWorkspace, "skills", "demo");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: demo",
          "description: Demo skill",
          'branch: {"requires":{"anyBins":["sandboxbin"]}}',
          "---",
          "# Demo",
          "",
        ].join("\n"),
        "utf8",
      );
      const skillsEligibility = {
        remote: {
          platforms: ["linux"],
          hasBin: () => false,
          hasAnyBin: (bins: string[]) => bins.includes("sandboxbin"),
          note: "sandbox",
        },
      };

      const {
        skillsEligibility: skillsEligibilityForRun,
        skillsPromptWorkspaceDir,
        skillsSnapshot: skillsSnapshotForRun,
        skillsWorkspaceDir,
        workspaceOnly,
      } = resolveSandboxSkillRuntimeInputs({
        sandbox: {
          enabled: true,
          containerWorkdir: "/workspace",
          skillsEligibility,
          skillsWorkspaceDir: materializedWorkspace,
          skillUsagePaths: [
            {
              readPath: path.join(skillDir, "SKILL.md"),
              skillFile: hostSkillPath,
              skillName: "demo",
              skillSource: "workspace",
            },
          ],
          workspaceAccess: "rw",
        },
        skillsAnchorWorkspace: effectiveWorkspace,
        skillsSnapshot,
      });
      const { shouldLoadSkillEntries, skillEntries } = await resolveEmbeddedRunSkillEntries({
        workspaceDir: skillsWorkspaceDir,
        eligibility: skillsEligibilityForRun,
        skillsSnapshot: skillsSnapshotForRun,
        workspaceOnly,
      });
      const promptSkillEntries = mapSandboxSkillEntriesForPrompt({
        entries: shouldLoadSkillEntries ? skillEntries : undefined,
        skillsWorkspaceDir,
        skillsPromptWorkspaceDir,
      });
      const prompt = await resolveSkillsPrompt({
        skillsSnapshot: skillsSnapshotForRun,
        entries: promptSkillEntries,
        workspaceDir: skillsPromptWorkspaceDir,
        eligibility: skillsEligibilityForRun,
      });

      if (skillsSnapshot === snapshot) {
        expect(prompt).toContain("/workspace/.branch/sandbox-skills/skills/demo/SKILL.md");
        const deliveredSkill = skillsSnapshotForRun?.resolvedSkills?.[0];
        expect(deliveredSkill).toBeDefined();
        if (!deliveredSkill) {
          throw new Error("missing delivered sandbox skill");
        }
        expect(resolveSkillFileHost(deliveredSkill)).toBeUndefined();
      } else {
        expect(prompt).toBe("");
        expect(skillEntries).toEqual([]);
      }
      expect(prompt.replaceAll("\\", "/")).not.toContain(
        materializedWorkspace.replaceAll("\\", "/"),
      );
      expect(prompt).not.toContain(hostSkillPath);
      expect(prompt).not.toContain("plugin-skills");
      expect(prompt.replaceAll("\\", "/")).not.toContain("/skills/canvas/SKILL.md");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves remote eligibility when rebuilding sandbox prompts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "branch-sandbox-skills-"));
    try {
      const skillDir = path.join(root, "skills", "macskill");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: macskill",
          "description: Mac-only remote skill",
          'branch: {"os":["darwin"]}',
          "---",
          "# Mac Skill",
          "",
        ].join("\n"),
        "utf8",
      );
      const skillsEligibility = {
        remote: {
          platforms: ["darwin"],
          hasBin: () => false,
          hasAnyBin: () => false,
          note: "remote mac available",
        },
      };

      const { shouldLoadSkillEntries, skillEntries } = await resolveEmbeddedRunSkillEntries({
        workspaceDir: root,
        eligibility: skillsEligibility,
        workspaceOnly: true,
      });
      const prompt = await resolveSkillsPrompt({
        entries: shouldLoadSkillEntries ? skillEntries : undefined,
        workspaceDir: root,
        eligibility: skillsEligibility,
      });

      expect(prompt).toContain("remote mac available");
      expect(prompt).toContain("macskill");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
