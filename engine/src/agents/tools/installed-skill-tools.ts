import { Type } from "typebox";
import { reviewSkillMarkdown } from "../../skills/review/skill-markdown-review.js";
import {
  bindAgentToolAvailability,
  getAgentToolAvailabilityBinding,
  type AgentToolAvailabilityBinding,
} from "../agent-tool-availability.js";
import {
  readInstalledSkill,
  searchInstalledSkills,
  type InstalledSkill,
} from "../installed-skill-catalog.js";
import {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readToolStringParam,
  type AnyAgentTool,
} from "./common.js";

export function createInstalledSkillTools(skills: readonly InstalledSkill[]): AnyAgentTool[] {
  if (skills.length === 0) {
    return [];
  }
  const readerBinding: AgentToolAvailabilityBinding = { prepare() {} };
  const authority: ReadAuthority = { current: undefined };
  return [
    createSkillSearchTool(skills, readerBinding, authority),
    createSkillReadTool(skills, readerBinding),
  ];
}

type ReadAuthority = { current: object | undefined };

async function executeSkillSearch(
  skills: readonly InstalledSkill[],
  authority: ReadAuthority,
  args: unknown,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const params = asToolParamsRecord(args);
  const captured = authority.current;
  return jsonResult(
    await searchInstalledSkills(
      skills,
      readToolStringParam(params, "query", { required: true }),
      readNumberParam(params, "limit"),
      signal,
      () => captured !== undefined && authority.current === captured,
    ),
  );
}

function createSkillSearchTool(
  skills: readonly InstalledSkill[],
  readerBinding: AgentToolAvailabilityBinding,
  authority: ReadAuthority,
): AnyAgentTool {
  return bindAgentToolAvailability<AnyAgentTool>(
    {
      name: "skills_search",
      label: "Search Installed Skills",
      description:
        "Find relevant installed, eligible skills by task or exact name, including skills omitted from the prompt directory. Searches names and descriptions, plus bounded instruction text when skill reads are allowed. Returns metadata only; coverage reports any incomplete body indexing. Read the selected skill's whole instructions before applying it. Does not search Seedbank or install anything.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1, maxLength: 1000 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_id, args, signal) =>
        await executeSkillSearch(skills, authority, args, signal),
    },
    {
      prepare(_tool, callableTools) {
        const reader = callableTools.get("skills_read");
        if (reader && getAgentToolAvailabilityBinding(reader) === readerBinding) {
          authority.current ??= {};
        } else {
          // A regrant gets a new identity; work started under a revoked grant stays revoked.
          authority.current = undefined;
        }
      },
    },
  );
}

function skillReadResult(name: string, content: string, shouldReview: boolean) {
  if (!shouldReview) {
    return { content: [{ type: "text" as const, text: content }], details: { name, content } };
  }
  const review = reviewSkillMarkdown(content);
  return {
    content: [
      { type: "text" as const, text: content },
      { type: "text" as const, text: `Static skill readiness facts:\n${JSON.stringify(review)}` },
    ],
    details: { name, content, review },
  };
}

function createSkillReadTool(
  skills: readonly InstalledSkill[],
  readerBinding: AgentToolAvailabilityBinding,
): AnyAgentTool {
  return bindAgentToolAvailability<AnyAgentTool>(
    {
      name: "skills_read",
      label: "Read Installed Skill",
      description:
        "Load complete SKILL.md instructions for an exact installed skill name. Use a known name directly; search is not required first. Set review=true to also receive static metadata readiness and resource-reference facts for these instructions. Review does not enumerate companion files or assess eval manifests, and never changes skill eligibility. Does not execute the skill or grant additional tool permissions.",
      parameters: Type.Object({
        name: Type.String({ minLength: 1 }),
        review: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, args, signal) => {
        const params = asToolParamsRecord(args);
        const name = readToolStringParam(params, "name", { required: true });
        const content = await readInstalledSkill(skills, name, signal);
        return skillReadResult(name, content, params.review === true);
      },
    },
    readerBinding,
  );
}
