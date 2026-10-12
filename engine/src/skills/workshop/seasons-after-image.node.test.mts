import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  prepareWorkspaceSkillMutation,
  applyWorkspaceSkillMutation,
} from "../lifecycle/workspace-skill-write.ts";
import { stripProposalFrontmatterForSkill } from "./frontmatter.ts";
import {
  buildSkillProposalEvaluationBundles,
  readSkillProposalTargetTreeSha256,
} from "./proposal-bundle.ts";
import type { SkillProposalReadResult } from "./types.ts";

function scratch() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "branch-seasons-tree-"));
  const skillsRoot = path.join(folder, "skills");
  fs.mkdirSync(skillsRoot);
  return {
    folder,
    skillsRoot,
    skillDir: path.join(skillsRoot, "example"),
    clean() {
      if (
        path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) ||
        !path.basename(folder).startsWith("branch-seasons-tree-")
      ) {
        throw new Error("Refusing unexpected test cleanup target.");
      }
      fs.rmSync(folder, { recursive: true, force: true });
    },
  };
}
function readFixture(kind: "create" | "update", skillDir: string): SkillProposalReadResult {
  return {
    record: { kind, target: { skillDir, skillFile: path.join(skillDir, "SKILL.md") } },
    content: "---\nname: example\ndescription: Example procedure\n---\n# After\n",
    supportFiles: [],
  } as unknown as SkillProposalReadResult;
}
test("actual absent create tree and filesystem apply match receipt after-image", async () => {
  const temp = scratch();
  try {
    const proposal = readFixture("create", temp.skillDir);
    const bundle = await buildSkillProposalEvaluationBundles({ proposal, supportFiles: [] });
    const mutation = await prepareWorkspaceSkillMutation({
      skillsRoot: temp.skillsRoot,
      skillDir: temp.skillDir,
      skillFile: proposal.record.target.skillFile,
      content: stripProposalFrontmatterForSkill(proposal.content),
      supportFiles: [],
      mode: "create",
    });
    await applyWorkspaceSkillMutation(mutation);
    assert.equal(
      await readSkillProposalTargetTreeSha256(temp.skillDir),
      bundle.candidate.treeSha256,
    );
    assert.match(fs.readFileSync(proposal.record.target.skillFile, "utf8"), /# After/u);
  } finally {
    temp.clean();
  }
});
test("actual support-file update retains unrelated files and matches whole-tree after-image", async () => {
  const temp = scratch();
  try {
    fs.mkdirSync(path.join(temp.skillDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(temp.skillDir, "SKILL.md"),
      "---\nname: example\ndescription: Example procedure\n---\n# Before\n",
    );
    fs.writeFileSync(path.join(temp.skillDir, "references", "guide.md"), "before support");
    fs.writeFileSync(path.join(temp.skillDir, "references", "keep.md"), "unrelated original");
    const proposal = readFixture("update", temp.skillDir);
    const supportFiles = [{ path: "references/guide.md", content: "after support" }];
    const bundle = await buildSkillProposalEvaluationBundles({ proposal, supportFiles });
    const mutation = await prepareWorkspaceSkillMutation({
      skillsRoot: temp.skillsRoot,
      skillDir: temp.skillDir,
      skillFile: proposal.record.target.skillFile,
      content: stripProposalFrontmatterForSkill(proposal.content),
      supportFiles,
      mode: "update",
    });
    assert.equal(await readSkillProposalTargetTreeSha256(temp.skillDir), bundle.targetTreeSha256);
    await applyWorkspaceSkillMutation(mutation);
    assert.equal(
      await readSkillProposalTargetTreeSha256(temp.skillDir),
      bundle.candidate.treeSha256,
    );
    assert.equal(
      fs.readFileSync(path.join(temp.skillDir, "references", "keep.md"), "utf8"),
      "unrelated original",
    );
    fs.writeFileSync(path.join(temp.skillDir, "references", "keep.md"), "later independent edit");
    assert.notEqual(
      await readSkillProposalTargetTreeSha256(temp.skillDir),
      bundle.candidate.treeSha256,
    );
  } finally {
    temp.clean();
  }
});
