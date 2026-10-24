import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillWorkshopTool } from "../../agents/tools/skill-workshop-tool.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { BranchSchema } from "../../config/zod-schema.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { hasWorkshopToolFiles } from "./capability-policy.js";
import { resolveSkillWorkshopToolApproval } from "./policy.js";
import {
  applySkillProposal,
  inspectSkillProposal,
  proposeCreateSkill,
  reviseSkillProposal,
} from "./service.js";
import { WORKSHOP_TOOL_APPROVAL_PARAM } from "./tool-approval.js";

const dirs = createTrackedTempDirs();
let state: BranchTestState;
let workspaceDir: string;
const config: BranchConfig = {
  skills: { workshop: { highestStep: "tool", approvalPolicy: "auto" } },
};
const skillConfig: BranchConfig = { skills: { workshop: { highestStep: "skill" } } };
const files = [
  {
    path: "scripts/normalize.mjs",
    content: "process.stdout.write(process.argv[2].trim().toLowerCase());\n",
  },
];
beforeEach(async () => {
  state = await createBranchTestState({ layout: "state-only", prefix: "budding-capability-" });
  workspaceDir = await dirs.make("budding-workspace-");
});
afterEach(async () => {
  await state.cleanup();
  await dirs.cleanup();
});
const context = () => ({ workspaceDir, config, agentId: "main", env: state.env });
const draft = () =>
  proposeCreateSkill({
    ...context(),
    name: "normalize-text",
    description: "Normalize text with the bundled tool.",
    content: "# Normalize text\n\nRun node scripts/normalize.mjs with the input text.\n",
    supportFiles: files,
  });
const approval = (id: string) =>
  resolveSkillWorkshopToolApproval({
    toolName: "skill_workshop",
    toolParams: { action: "apply", proposal_id: id },
    workspaceDir,
    agentId: "main",
    config,
  });

describe("Budding capability enforcement", () => {
  it("accepts real steps and rejects unsupported add-on and code routes", () => {
    expect(BranchSchema.safeParse(skillConfig).success).toBe(true);
    expect(BranchSchema.safeParse(config).success).toBe(true);
    for (const highestStep of ["addon", "code"]) {
      expect(BranchSchema.safeParse({ skills: { workshop: { highestStep } } }).success).toBe(false);
    }
    expect(hasWorkshopToolFiles([{ path: "references/check.MJS" }])).toBe(true);
    expect(hasWorkshopToolFiles([{ path: "scripts/data.json" }])).toBe(true);
    expect(hasWorkshopToolFiles([{ path: "references/help.md" }])).toBe(false);
  });

  it("skill step rejects tool creation, revision, and publication after lowering the step", async () => {
    await expect(
      proposeCreateSkill({
        ...context(),
        config: skillConfig,
        name: "blocked-tool",
        description: "A tool",
        content: "# Tool\n",
        supportFiles: files,
      }),
    ).rejects.toThrow("highest step is A skill");
    const proposal = await draft();
    await expect(
      reviseSkillProposal({
        ...context(),
        config: skillConfig,
        proposalId: proposal.record.id,
        content: "# Revised tool\n",
      }),
    ).rejects.toThrow("highest step is A skill");
    await expect(
      applySkillProposal({
        ...context(),
        config: skillConfig,
        proposalId: proposal.record.id,
        eventActor: { type: "gateway" },
      }),
    ).rejects.toThrow("highest step is A skill");
    await expect(fs.access(proposal.record.target.skillFile)).rejects.toThrow();
    expect((await inspectSkillProposal(proposal.record.id, context()))?.record.status).toBe(
      "pending",
    );
  });

  it("requires exact-revision approval even with automatic policy, then publishes a working tool", async () => {
    const proposal = await draft();
    const tool = createSkillWorkshopTool(context());
    await expect(
      tool.execute("unapproved", { action: "apply", proposal_id: proposal.record.id }),
    ).rejects.toThrow("requires approval");
    const gate = await approval(proposal.record.id);
    expect(gate?.requireApproval?.title).toBe("Publish a Workshop tool");
    expect(gate?.params?.expected_revision_hash).toBe(proposal.revisionHash);
    await gate?.requireApproval?.onResolution?.("allow-once");
    await tool.execute("approved", gate?.params);
    expect((await inspectSkillProposal(proposal.record.id, context()))?.record.status).toBe(
      "applied",
    );
    const executable = path.join(proposal.record.target.skillDir, files[0].path);
    const result = await promisify(execFile)(process.execPath, [executable, " HELLO "], {
      windowsHide: true,
      timeout: 5000,
    });
    expect(result.stdout).toBe("hello");
  });

  it.each(["deny", "timeout", "cancelled"] as const)(
    "leaves a tool inactive after %s",
    async (decision) => {
      const proposal = await draft();
      const gate = await approval(proposal.record.id);
      await gate?.requireApproval?.onResolution?.(decision);
      await expect(
        createSkillWorkshopTool(context()).execute("denied", gate?.params),
      ).rejects.toThrow("requires approval");
      await expect(fs.access(proposal.record.target.skillFile)).rejects.toThrow();
    },
  );

  it("rejects forged receipts and refuses an approved revision after it changes", async () => {
    const proposal = await draft();
    const tool = createSkillWorkshopTool(context());
    await expect(
      tool.execute("forged", {
        action: "apply",
        proposal_id: proposal.record.id,
        [WORKSHOP_TOOL_APPROVAL_PARAM]: "invented",
      }),
    ).rejects.toThrow("requires approval");
    const gate = await approval(proposal.record.id);
    await gate?.requireApproval?.onResolution?.("allow-once");
    await reviseSkillProposal({
      ...context(),
      proposalId: proposal.record.id,
      content: "# Changed\n",
    });
    await expect(tool.execute("stale", gate?.params)).rejects.toThrow("revision");
    await expect(fs.access(proposal.record.target.skillFile)).rejects.toThrow();
  });

  it("blocks autonomous publication but allows an explicit operator to approve the tool", async () => {
    const proposal = await draft();
    await expect(
      applySkillProposal({
        ...context(),
        proposalId: proposal.record.id,
        eventActor: { type: "system", id: "autonomous-review" },
      }),
    ).rejects.toThrow("remain pending");
    await applySkillProposal({
      ...context(),
      proposalId: proposal.record.id,
      expectedRevisionHash: proposal.revisionHash,
      eventActor: { type: "gateway" },
    });
    expect((await inspectSkillProposal(proposal.record.id, context()))?.record.status).toBe(
      "applied",
    );
  });
});
