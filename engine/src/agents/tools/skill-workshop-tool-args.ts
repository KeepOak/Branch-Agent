// Accepts the common `name` spelling for actions that target an existing live skill,
// and names the field with a correct example call when the skill is missing entirely.
import {
  asToolParamsRecord,
  readToolStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const SKILL_NAME_EXAMPLES: Readonly<Record<string, string>> = {
  read: '{ action: "read", skill_name: "my-skill" }',
  prepare_patch:
    '{ action: "prepare_patch", skill_name: "my-skill", old_string: "exact current text" }',
  patch:
    '{ action: "patch", skill_name: "my-skill", old_string: "exact current text", new_string: "replacement text" }',
  update: '{ action: "update", skill_name: "my-skill", proposal_content: "complete skill body" }',
};

type SkillNameArgument = {
  params: Record<string, unknown>;
  action?: string;
  note?: string;
};

/** For read/prepare_patch/patch/update, `name` has no other meaning, so it is unambiguous. */
export function resolveSkillNameArgument(args: unknown): SkillNameArgument {
  const params = asToolParamsRecord(args);
  const action = readToolStringParam(params, "action");
  if (!action || !Object.hasOwn(SKILL_NAME_EXAMPLES, action)) {
    return { params, action };
  }
  if (readToolStringParam(params, "skill_name") !== undefined) {
    return { params, action };
  }
  const name = readToolStringParam(params, "name");
  if (name === undefined) {
    return { params, action };
  }
  const { name: _name, ...rest } = params;
  return {
    params: { ...rest, skill_name: name },
    action,
    note: `Used name "${name}" as skill_name: action=${action} takes skill_name, for example ${SKILL_NAME_EXAMPLES[action]}.`,
  };
}

function appendArgumentNote(
  result: Awaited<ReturnType<AnyAgentTool["execute"]>>,
  note: string,
): Awaited<ReturnType<AnyAgentTool["execute"]>> {
  const details = result.details;
  return {
    ...result,
    content: [{ type: "text", text: note }, ...result.content],
    details:
      details && typeof details === "object" && !Array.isArray(details)
        ? { ...details, argumentNote: note }
        : details,
  };
}

/** Wraps skill_workshop so a known wrong field name is coerced and a missing one is explained. */
export function withSkillNameArgument(tool: AnyAgentTool): AnyAgentTool {
  const execute = tool.execute;
  return {
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const { params, action, note } = resolveSkillNameArgument(args);
      let result: Awaited<ReturnType<AnyAgentTool["execute"]>>;
      try {
        result = await execute(toolCallId, params, signal, onUpdate);
      } catch (error) {
        const example = action ? SKILL_NAME_EXAMPLES[action] : undefined;
        if (example && error instanceof ToolInputError && error.message === "skill_name required") {
          throw new ToolInputError(
            `skill_name required for action=${action}: pass the Workshop skill name, for example ${example}`,
          );
        }
        throw error;
      }
      return note ? appendArgumentNote(result, note) : result;
    },
  };
}
