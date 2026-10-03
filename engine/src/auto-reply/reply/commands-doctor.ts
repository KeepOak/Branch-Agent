/** Routes /doctor into a normal primary-agent investigation in the current conversation. */
import { buildContextDoctorPrompt } from "../../skills/context-doctor-prompt.js";
import { skillCommandsToExplicitSelections } from "../../skills/discovery/chat-command-invocation.js";
import type { SkillCommandSpec } from "../../skills/types.js";
import { applyCommandTextToParams } from "./command-context-rewrite.js";
import { commandReply, defineAuthorizedTextCommand, matchCommandPrefix } from "./command-gates.js";
import type { HandleCommandsParams } from "./commands-types.js";

async function loadContextDoctorSkill(
  params: HandleCommandsParams,
): Promise<SkillCommandSpec | undefined> {
  const bundled = await params.loadBundledSkillCommand?.("context-doctor");
  if (bundled) {
    return bundled;
  }
  const skills = (await params.loadSkillCommands?.()) ?? params.skillCommands ?? [];
  return skills.find(
    (skill) => skill.skillSource === "bundled" && skill.skillName === "context-doctor",
  );
}

export const handleDoctorCommand = defineAuthorizedTextCommand(
  { label: "/doctor", match: (body) => matchCommandPrefix(body, "/doctor") },
  async (params, symptom) => {
    const skill = await loadContextDoctorSkill(params);
    if (!skill?.skillFile) {
      return commandReply(
        "Context investigation is unavailable because the context-doctor skill is unavailable for this agent.",
      );
    }
    const prompt = buildContextDoctorPrompt({
      agentId: params.agentId ?? "main",
      sessionKey: params.sessionKey,
      sessionId: params.sessionEntry?.sessionId,
      workspaceDir: params.workspaceDir,
      agentDir: params.agentDir,
      provider: params.provider,
      model: params.model,
      skillFile: skill.skillFile,
      symptom,
    });
    applyCommandTextToParams(params, prompt);
    return {
      shouldContinue: true,
      explicitSkillSelections: skillCommandsToExplicitSelections([skill]),
    };
  },
);
