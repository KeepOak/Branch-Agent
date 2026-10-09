/**
 * Reads one Trunk and returns its template. Allowlist only: the name, the persona files
 * AGENTS.md and SOUL.md, the skill slugs, and a model family. Everything else on the Trunk
 * (memory, USER.md, secrets, accounts, auth profiles, machine names, paths, workspace)
 * is never read into the output.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentConfig, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { BranchConfig } from "../config/types.branch.js";
import {
  buildTrunkTemplate,
  redactPersonaText,
  type TrunkTemplate,
} from "./trunk-template.js";

const PERSONA_FILE_LIMIT_BYTES = 64 * 1024;

async function readPersonaFile(filePath: string): Promise<string | undefined> {
  try {
    const text = await readFile(filePath, "utf8");
    return text.slice(0, PERSONA_FILE_LIMIT_BYTES);
  } catch {
    return undefined;
  }
}

/** "openai-codex/gpt-5.5" -> "gpt-5.5". Provider, account and profile never reach a template. */
export function modelFamilyFromRef(ref: string | undefined): string | undefined {
  const model = ref?.split("/").pop()?.split("@")[0]?.trim();
  return model || undefined;
}

export async function exportTrunkTemplate(params: {
  cfg: BranchConfig;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<TrunkTemplate | undefined> {
  const agent = resolveAgentConfig(params.cfg, params.agentId);
  if (!agent) {
    return undefined;
  }
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId, params.env);
  const homeDir = os.homedir();
  const paths = { workspaceDir, homeDir };
  const agentsMd = await readPersonaFile(path.join(workspaceDir, "AGENTS.md"));
  const soulMd = await readPersonaFile(path.join(workspaceDir, "SOUL.md"));
  const modelRef = typeof agent.model === "string" ? agent.model : agent.model?.primary;
  return buildTrunkTemplate({
    name: agent.name ?? params.agentId,
    agentsMd: redactPersonaText(agentsMd ?? "", paths),
    soulMd: soulMd === undefined ? undefined : redactPersonaText(soulMd, paths),
    skillSlugs: agent.skills ?? [],
    modelFamily: modelFamilyFromRef(modelRef),
  });
}
