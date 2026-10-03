import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { SkillCommandSpec } from "../../skills/types.js";
import { handleDoctorCommand } from "./commands-doctor.js";
import type { HandleCommandsParams } from "./commands-types.js";

const bundledSkill: SkillCommandSpec = {
  name: "context_doctor",
  skillName: "context-doctor",
  description: "Investigate context.",
  skillFile: path.resolve("skills/context-doctor/SKILL.md"),
  skillSource: "bundled",
  modelVisible: true,
};

function params(body = "/doctor"): HandleCommandsParams {
  return {
    cfg: {},
    ctx: { BodyForAgent: body },
    rootCtx: { BodyForAgent: body },
    command: {
      commandBodyNormalized: body,
      rawBodyNormalized: body,
      isAuthorizedSender: true,
      senderIsOwner: false,
      senderId: "fixture-member",
      channel: "webchat",
      surface: "webchat",
    },
    agentId: "sapling",
    sessionKey: "agent:sapling:investigation",
    sessionEntry: { sessionId: "conversation-investigation" },
    workspaceDir: "/fixture/workspace",
    provider: "fixture",
    model: "fixture",
    skillCommands: [bundledSkill],
  } as unknown as HandleCommandsParams;
}

it("runs an authorized member's investigation as the current primary-agent turn", async () => {
  const input = params("/doctor Inspect conversation-incident for repeated failures");
  const result = await handleDoctorCommand(input, true);
  expect(result).toEqual({
    shouldContinue: true,
    explicitSkillSelections: [{ name: "context_doctor", path: bundledSkill.skillFile }],
  });
  expect(input.ctx.BodyForAgent).toContain("conversation-incident");
  expect(input.ctx.BodyForAgent).toContain("agent:sapling:investigation");
  expect(input.rootCtx?.BodyForAgent).toBe(input.ctx.BodyForAgent);
  expect(input.command.commandBodyNormalized).toBe(input.ctx.BodyForAgent);
  expect(input.sessionKey).toBe("agent:sapling:investigation");
  expect(result?.reply).toBeUndefined();
});

it("selects the bundled investigation skill over a workspace name collision", async () => {
  const input = params();
  input.skillCommands = [
    { ...bundledSkill, skillSource: "workspace", skillFile: "/workspace/collision.md" },
  ];
  input.loadBundledSkillCommand = vi.fn(async () => bundledSkill);
  const result = await handleDoctorCommand(input, true);
  expect(result?.explicitSkillSelections?.[0]?.path).toBe(bundledSkill.skillFile);
  expect(input.loadBundledSkillCommand).toHaveBeenCalledWith("context-doctor");
});

it("fails before rewriting the conversation if the workflow skill is unavailable", async () => {
  const input = params();
  input.skillCommands = [];
  const result = await handleDoctorCommand(input, true);
  expect(result?.shouldContinue).toBe(false);
  expect(result?.reply?.text).toContain("context-doctor skill is unavailable");
  expect(input.ctx.BodyForAgent).toBe("/doctor");
});

it("does not load a skill for disabled, unauthorized, or unrelated commands", async () => {
  const input = params();
  input.loadBundledSkillCommand = vi.fn(async () => bundledSkill);
  expect(await handleDoctorCommand(input, false)).toBeNull();
  input.command.isAuthorizedSender = false;
  expect((await handleDoctorCommand(input, true))?.shouldContinue).toBe(false);
  input.command.isAuthorizedSender = true;
  input.command.commandBodyNormalized = "/doctorate";
  expect(await handleDoctorCommand(input, true)).toBeNull();
  expect(input.loadBundledSkillCommand).not.toHaveBeenCalled();
});

it("ships the investigation and memory references without broken local links", () => {
  const root = path.dirname(bundledSkill.skillFile);
  const text = fs.readFileSync(bundledSkill.skillFile, "utf8");
  const links = [...text.matchAll(/\]\((references\/[^)]+)\)/gu)].map((match) => match[1]!);
  expect(links).toHaveLength(2);
  for (const reference of links) {
    expect(fs.readFileSync(path.join(root, reference), "utf8").length).toBeGreaterThan(0);
  }
});
