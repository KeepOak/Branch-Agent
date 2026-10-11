/**
 * Reads one Trunk and returns its template. Allowlist only: the name, the persona files
 * AGENTS.md and SOUL.md, the skill slugs, and a model family. Everything else on the Trunk
 * (memory, USER.md, secrets, accounts, auth profiles, machine names, paths, workspace)
 * is never read into the output. Export refuses persona text that looks like a secret.
 */
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentConfig, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveAgentEntry } from "../agents/agent-scope-config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { redactSensitiveText } from "../logging/redact.js";
import {
  buildTrunkTemplate,
  redactPersonaText,
  type TrunkTemplate,
} from "./trunk-template.js";

const PERSONA_FILE_LIMIT_BYTES = 64 * 1024;
const RESTRICTED_PERMISSION =
  "This Trunk has its own tool list or tool switches. The template does not carry them: set them after creating the Trunk.";
const GLOBAL_RESTRICTED_PERMISSION =
  "Tool limits from this computer's settings are not in the template: set the tools you want after creating the Trunk.";
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const SECRET_REFUSAL =
  "Persona text looks like it contains a secret (a token or key). Remove it from AGENTS.md or SOUL.md, then export again.";

export type TrunkTemplateExport =
  | { ok: true; template: TrunkTemplate; warnings: string[] }
  | { ok: false; error: string };

/** Reads at most PERSONA_FILE_LIMIT_BYTES bytes. Reports whether the file was cut. */
async function readPersonaFile(
  filePath: string,
): Promise<{ text: string; truncated: boolean } | undefined> {
  try {
    const bytes = await readFile(filePath);
    return {
      text: bytes.subarray(0, PERSONA_FILE_LIMIT_BYTES).toString("utf8"),
      truncated: bytes.length > PERSONA_FILE_LIMIT_BYTES,
    };
  } catch {
    return undefined;
  }
}

/** "openai-codex/gpt-5.5" -> "gpt-5.5". Provider, account and profile never reach a template. */
export function modelFamilyFromRef(ref: string | undefined): string | undefined {
  const model = ref?.split("/").pop()?.split("@")[0]?.trim();
  return model || undefined;
}

function hasToolLimit(tools: unknown): boolean {
  const limits = (tools ?? {}) as Record<string, unknown>;
  const listed = ["allow", "alsoAllow", "deny"].some(
    (key) => Array.isArray(limits[key]) && (limits[key] as unknown[]).length > 0,
  );
  const byProvider = limits.byProvider as Record<string, unknown> | undefined;
  const fs = limits.fs as Record<string, unknown> | undefined;
  return (
    listed ||
    Boolean(limits.profile) ||
    Boolean(byProvider && Object.keys(byProvider).length) ||
    fs?.workspaceOnly === true
  );
}

/** Permission lines in plain words, from what the Trunk's own settings and the computer's settings limit. */
function permissionsFor(cfg: BranchConfig, agentId: string): string[] {
  const entry = resolveAgentEntry(cfg, agentId) as { toolsets?: unknown } | undefined;
  const ownSwitches = Object.keys((entry?.toolsets ?? {}) as Record<string, unknown>).length > 0;
  const ownLimit = hasToolLimit((entry as { tools?: unknown } | undefined)?.tools) || ownSwitches;
  const lines: string[] = [];
  if (ownLimit) {
    lines.push(RESTRICTED_PERMISSION);
  }
  if (hasToolLimit(cfg.tools)) {
    lines.push(GLOBAL_RESTRICTED_PERMISSION);
  }
  return lines;
}

export async function exportTrunkTemplate(params: {
  cfg: BranchConfig;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<TrunkTemplateExport> {
  const agent = resolveAgentConfig(params.cfg, params.agentId);
  if (!agent) {
    return { ok: false, error: `Trunk "${params.agentId}" was not found.` };
  }
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId, params.env);
  const paths = { workspaceDir, homeDir: os.homedir() };
  const agentsMd = await readPersonaFile(path.join(workspaceDir, "AGENTS.md"));
  const soulMd = await readPersonaFile(path.join(workspaceDir, "SOUL.md"));
  const rawPersona = [agentsMd?.text ?? "", soulMd?.text ?? ""];
  if (rawPersona.some((text) => PRIVATE_KEY_HEADER.test(text))) {
    return { ok: false, error: SECRET_REFUSAL };
  }
  const agentsText = agentsMd === undefined ? "" : redactPersonaText(agentsMd.text, paths);
  const soulText = soulMd === undefined ? undefined : redactPersonaText(soulMd.text, paths);
  const scanned = [agentsText, soulText ?? ""];
  if (scanned.some((text) => redactSensitiveText(text) !== text)) {
    return { ok: false, error: SECRET_REFUSAL };
  }
  const cut = [
    agentsMd?.truncated ? "AGENTS.md" : undefined,
    soulMd?.truncated ? "SOUL.md" : undefined,
  ].filter((name): name is string => name !== undefined);
  const modelRef = typeof agent.model === "string" ? agent.model : agent.model?.primary;
  const { template, warnings } = buildTrunkTemplate({
    name: agent.name ?? params.agentId,
    agentsMd: agentsText,
    soulMd: soulText,
    skillSlugs: agent.skills ?? [],
    modelFamily: modelFamilyFromRef(modelRef),
    permissions: permissionsFor(params.cfg, params.agentId),
  });
  const truncation = cut.map((name) => `${name} was cut to 64 KB for the template.`);
  return { ok: true, template, warnings: [...warnings, ...truncation] };
}
