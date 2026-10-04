import { readCodeModeSkill } from "../../agents/code-mode-skills.js";
import { canonicalizePath } from "../../agents/utils/paths.js";
import {
  getAgentWorkspaceAccess,
  isWorkspaceAccessUnavailableError,
  WorkspaceAccessUnavailableError,
} from "../../agents/workspace-access.js";
import { emitTrustedSkillUsedDiagnosticEvent } from "../../infra/diagnostic-events.js";
import { resolveSkillKey } from "../loading/frontmatter.js";
import { resolveSkillTelemetrySource } from "../loading/source.js";
import type { ExplicitSkillSelection, SkillBundle, SkillEntry } from "../types.js";
import { recordRunSkillUsage, type RunSkillUsage } from "./run-usage.js";

export type SkillBundleInvocation = {
  message: string;
  loaded: string[];
  missing: string[];
  disabled: string[];
  selections: ExplicitSkillSelection[];
  usages: RunSkillUsage[];
};
type InvocationParams = {
  workspaceDir: string;
  bundle: SkillBundle;
  entries: SkillEntry[];
  eligible: SkillEntry[];
  userInstruction?: string;
  signal?: AbortSignal;
  assertCurrent: () => void;
};

function resolveMember(identifier: string, entries: SkillEntry[]): SkillEntry | undefined {
  const matches = entries.filter(
    (entry) =>
      identifier === entry.skill.name ||
      identifier === resolveSkillKey(entry.skill, entry) ||
      identifier === entry.skill.filePath,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

async function readMember(entry: SkillEntry, params: InvocationParams): Promise<string> {
  params.signal?.throwIfAborted();
  params.assertCurrent();
  const skill = entry.skill;
  const access =
    skill.fileHost === "workspace" ||
    (skill.fileHost !== "gateway" && typeof skill.readContent !== "string")
      ? getAgentWorkspaceAccess(params.workspaceDir, "loadSkills")
      : undefined;
  if (access?.loadSkills && !access.skillResources) {
    throw new WorkspaceAccessUnavailableError(
      "Remote workspace skill instructions are unavailable",
    );
  }
  const reader = access?.loadSkills ? access.skillResources?.readInstructions : undefined;
  const body = await readCodeModeSkill(
    {
      name: skill.name,
      description: skill.description,
      location: skill.filePath,
      source: skill,
      ...(reader ? { reader: ({ location, signal }) => reader(location, { signal }) } : {}),
    },
    params.signal,
  );
  params.signal?.throwIfAborted();
  params.assertCurrent();
  return body;
}

function memberBlock(bundle: SkillBundle, entry: SkillEntry, body: string): string {
  const skill = entry.skill;
  const location = skill.locationNote || `Skill location: ${skill.filePath}`;
  const directory =
    !skill.filePath.includes("://") && skill.baseDir
      ? `Resolve relative skill resources against this skill directory: ${skill.baseDir}`
      : "";
  return [`[Loaded as part of the "${bundle.name}" skill bundle.]`, body, location, directory]
    .filter(Boolean)
    .join("\n\n");
}

function bundleHeader(params: InvocationParams, result: SkillBundleInvocation): string {
  return [
    `[IMPORTANT: The user has invoked the "${params.bundle.name}" skill bundle, loading ${result.loaded.length} skills together. Treat every skill below as active guidance for this turn.]`,
    "",
    `Bundle: ${params.bundle.name}`,
    `Skills loaded: ${result.loaded.join(", ")}`,
    result.missing.length ? `Skills missing (skipped): ${result.missing.join(", ")}` : "",
    result.disabled.length
      ? `Skills disabled or ineligible (skipped): ${result.disabled.join(", ")}`
      : "",
    params.bundle.instruction ? `\nBundle instruction: ${params.bundle.instruction}` : "",
    params.userInstruction ? `\nUser instruction: ${params.userInstruction}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function appendMember(
  identifier: string,
  params: InvocationParams,
  result: SkillBundleInvocation,
  blocks: string[],
): Promise<void> {
  params.signal?.throwIfAborted();
  params.assertCurrent();
  const member = resolveMember(identifier, params.entries);
  if (!member) {
    result.missing.push(identifier);
    return;
  }
  if (!params.eligible.includes(member)) {
    result.disabled.push(member.skill.name);
    return;
  }
  try {
    const body = await readMember(member, params);
    result.loaded.push(member.skill.name);
    result.selections.push({
      name: member.skill.name,
      path: canonicalizePath(member.skill.filePath),
    });
    result.usages.push({
      name: member.skill.name,
      source: resolveSkillTelemetrySource(member.skill),
      activation: "command",
      skillFile: canonicalizePath(member.skill.filePath),
    });
    blocks.push(memberBlock(params.bundle, member, body));
  } catch (error) {
    params.signal?.throwIfAborted();
    params.assertCurrent();
    if (isWorkspaceAccessUnavailableError(error)) {
      throw error;
    }
    result.missing.push(identifier);
  }
}

/** Read only fresh admitted identities; YAML identifiers never create filesystem authority. */
export async function composeSkillBundleInvocation(
  params: InvocationParams,
): Promise<SkillBundleInvocation | undefined> {
  const result: SkillBundleInvocation = {
    message: "",
    loaded: [],
    missing: [],
    disabled: [],
    selections: [],
    usages: [],
  };
  const blocks: string[] = [];
  for (const identifier of new Set(params.bundle.skills)) {
    await appendMember(identifier, params, result, blocks);
  }
  params.signal?.throwIfAborted();
  params.assertCurrent();
  if (!blocks.length) {
    return undefined;
  }
  result.message = [bundleHeader(params, result), ...blocks].join("\n\n");
  return result;
}

/** Whole-body activation has no second tool read; record each canonical member once. */
export function recordSkillBundleInvocationUsage(
  invocation: SkillBundleInvocation,
  context: { runId?: string; sessionKey?: string; agentId?: string },
): void {
  const used = new Set<string>();
  for (const usage of invocation.usages) {
    const key = `${usage.name}\0${usage.skillFile}`;
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    recordRunSkillUsage({ ...usage, runId: context.runId });
    emitTrustedSkillUsedDiagnosticEvent(
      {
        type: "skill.used",
        ...context,
        skillName: usage.name,
        skillSource: usage.source,
        activation: "command",
      },
      usage.skillFile ? { skillUsage: { skillFile: usage.skillFile } } : undefined,
    );
  }
}
