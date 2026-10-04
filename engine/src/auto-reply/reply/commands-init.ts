// Adapted from letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba src/cli/helpers/init-command.ts
// (/init: gather git context, then hand the agent the initializing-memory skill).
import { executeGitCommand } from "../../infra/git-exec.js";
import {
  expandExplicitSkillReferences,
  skillCommandsToExplicitSelections,
} from "../../skills/discovery/chat-command-invocation.js";
import { applyCommandTextToParams } from "./command-context-rewrite.js";
import { commandReply, defineAuthorizedTextCommand } from "./command-gates.js";
import { matchSlashCommandToken } from "./commands-slash-parse.js";
import type { CommandHandler, HandleCommandsParams } from "./commands-types.js";

const INIT_COMMAND = "/init";
const INITIALIZING_MEMORY_SKILL = "initializing-memory";
const GIT_CONTEXT_TIMEOUT_MS = 5_000;

type InitGitContext = { context: string; identity: string };

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await executeGitCommand(cwd, args, { timeoutMs: GIT_CONTEXT_TIMEOUT_MS });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/** Branch, status, recent commits and the git user of the workspace, when it is a repository. */
export async function gatherInitGitContext(cwd: string): Promise<InitGitContext> {
  try {
    if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true") {
      return { context: "(not a git repository)", identity: "" };
    }
    const [branch, status, recentCommits, userName, userEmail] = await Promise.all([
      git(cwd, ["branch", "--show-current"]),
      git(cwd, ["status", "--short"]),
      git(cwd, ["log", "--oneline", "-10"]),
      git(cwd, ["config", "user.name"]),
      git(cwd, ["config", "user.email"]),
    ]);
    const identity = [userName, userEmail ? `<${userEmail}>` : ""].filter(Boolean).join(" ");
    return {
      context: `
- branch: ${branch || "(unknown)"}
- status: ${status || "(clean)"}

Recent commits:
${recentCommits || "No commits yet"}
`,
      identity,
    };
  } catch {
    return { context: "", identity: "" };
  }
}

/** Message for the agent when the user runs /init. */
export function buildInitMessage(args: {
  gitContext: string;
  gitIdentity?: string;
  memoryDir?: string;
  request?: string;
}): string {
  const memorySection = args.memoryDir
    ? `\n## Memory files\n\nYour memory files live in your workspace: \`${args.memoryDir}\` (AGENTS.md, SOUL.md, USER.md, MEMORY.md and memory/).\n`
    : "";
  const identityLine = args.gitIdentity ? `\n- git_user: ${args.gitIdentity}` : "";
  const requestSection = args.request?.trim()
    ? `\n## User request\n\n${args.request.trim()}\n`
    : "";
  return `The user has requested memory initialization via /init.
${memorySection}
## 1. Use the initializing-memory skill

Follow the \`${INITIALIZING_MEMORY_SKILL}\` skill selected for this turn: it has the comprehensive instructions for memory initialization.

If the skill is unavailable, proceed with your best judgment based on these guidelines:
- Ask upfront questions (research depth, identity, related repos, workflow style)
- Research the project based on chosen depth
- Create/update memory files incrementally
- Reflect and verify completeness

## 2. Follow the skill instructions

Once loaded, follow the instructions from the \`${INITIALIZING_MEMORY_SKILL}\` skill to complete the initialization.
${requestSection}
## Git
${args.gitContext}${identityLine}
`;
}

async function loadInitializingMemorySkill(params: HandleCommandsParams) {
  const loaded = (await params.loadSkillCommands?.()) ?? params.skillCommands ?? [];
  const skill =
    (await params.loadBundledSkillCommand?.(INITIALIZING_MEMORY_SKILL)) ??
    loaded.find(
      (entry) =>
        entry.skillSource === "bundled" &&
        entry.skillName.trim().toLowerCase() === INITIALIZING_MEMORY_SKILL,
    );
  return skill
    ? {
        skill,
        available: [skill, ...loaded.filter((entry) => entry.skillFile !== skill.skillFile)],
      }
    : null;
}

/** Built-in /init: an agent turn that studies the project and the user and writes memory files. */
export const handleInitCommand: CommandHandler = defineAuthorizedTextCommand(
  { label: INIT_COMMAND, match: (body) => matchSlashCommandToken(body, INIT_COMMAND) },
  async (params, request) => {
    const skills = await loadInitializingMemorySkill(params);
    if (!skills) {
      return commandReply(
        "Memory initialization is unavailable because the initializing-memory skill is unavailable for this agent.",
      );
    }
    const git = await gatherInitGitContext(params.workspaceDir);
    const message = buildInitMessage({
      gitContext: git.context,
      gitIdentity: git.identity,
      memoryDir: params.workspaceDir,
      request,
    });
    const expanded = expandExplicitSkillReferences({
      text: `$${skills.skill.name} ${message}`,
      skillCommands: skills.available,
    });
    if (expanded.error || expanded.skills.length === 0) {
      return commandReply(expanded.error ?? "The initializing-memory skill could not be selected.");
    }
    const explicitSkillSelections = skillCommandsToExplicitSelections(expanded.skills);
    if (explicitSkillSelections.length === 0) {
      return commandReply("The initializing-memory skill file could not be resolved.");
    }
    applyCommandTextToParams(params, expanded.body);
    return { shouldContinue: true, explicitSkillSelections };
  },
);
