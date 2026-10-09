/**
 * Trunk templates: a shareable, secret-free recipe for a Trunk, stored as
 * branch.trunk-template.json. Pure data and functions. The exporter reads a Trunk and
 * hands only the fields below to buildTrunkTemplate, so nothing else can leave.
 */

export const TRUNK_TEMPLATE_FILE_NAME = "branch.trunk-template.json";
export const TRUNK_TEMPLATE_FORMAT = "branch.trunk-template";
export const TRUNK_TEMPLATE_VERSION = 1;

const SEEDBANK_SKILL_PREFIX = "seedbank:@branch-agent/";
const SKILL_ID_PATTERN = /^seedbank:@branch-agent\/([a-z0-9][a-z0-9-]*)(?:@\S+)?$/;

export type TrunkTemplateAutomation = { name: string; cron: string; prompt: string };

export type TrunkTemplate = {
  format: typeof TRUNK_TEMPLATE_FORMAT;
  version: typeof TRUNK_TEMPLATE_VERSION;
  name: string;
  description: string;
  persona: { agentsMd: string; soulMd?: string };
  /** Catalog ids, `seedbank:@branch-agent/<slug>` with an optional `@version`. */
  skills: string[];
  /** Named toolsets; a missing name is on. */
  toolsets: Record<string, boolean>;
  /** A model family such as "gpt-5.5". Never an account, key or auth profile. */
  model?: { family: string };
  automations?: TrunkTemplateAutomation[];
  /** What the Trunk may reach, in plain words. */
  permissions: string[];
};

/** The only fields the exporter may pass in. Anything else on a Trunk stays on it. */
export type TrunkTemplateSource = {
  name: string;
  description?: string;
  agentsMd?: string;
  soulMd?: string;
  skillSlugs?: string[];
  toolsets?: Record<string, boolean>;
  modelFamily?: string;
  automations?: TrunkTemplateAutomation[];
};

export function skillIdForSlug(slug: string): string {
  return `${SEEDBANK_SKILL_PREFIX}${slug}`;
}

/** The bare slug a catalog skill id installs under, or undefined for a malformed id. */
export function skillSlugForId(id: string): string | undefined {
  return SKILL_ID_PATTERN.exec(id)?.[1];
}

/** Keeps explicit boolean switches only. Names are checked against the toolset list once it lands. */
function toolsetSwitches(toolsets: Record<string, boolean> | undefined) {
  return Object.fromEntries(
    Object.entries(toolsets ?? {}).filter((pair): pair is [string, boolean] => typeof pair[1] === "boolean"),
  );
}

function permissionsFor(toolsets: Record<string, boolean>): string[] {
  const off = Object.keys(toolsets).filter((id) => toolsets[id] === false);
  return off.length
    ? [`Turned off: ${off.join(", ")}. Every other toolset is on.`]
    : ["Every toolset is on."];
}

/** Shapes a template from the allowlisted source. Persona text must already be redacted. */
export function buildTrunkTemplate(source: TrunkTemplateSource): TrunkTemplate {
  const toolsets = toolsetSwitches(source.toolsets);
  const template: TrunkTemplate = {
    format: TRUNK_TEMPLATE_FORMAT,
    version: TRUNK_TEMPLATE_VERSION,
    name: source.name.trim(),
    description: source.description?.trim() ?? "",
    persona: {
      agentsMd: source.agentsMd ?? "",
      ...(source.soulMd ? { soulMd: source.soulMd } : {}),
    },
    skills: [...new Set((source.skillSlugs ?? []).map(skillIdForSlug))],
    toolsets,
    ...(source.modelFamily ? { model: { family: source.modelFamily } } : {}),
    ...(source.automations?.length ? { automations: source.automations } : {}),
    permissions: permissionsFor(toolsets),
  };
  return template;
}

/** Replaces the workspace and home directories in free text so no machine path leaves. */
export function redactPersonaText(
  text: string,
  paths: { workspaceDir?: string; homeDir?: string },
): string {
  let out = text;
  const replacements: Array<[string, string]> = [];
  if (paths.workspaceDir) {
    replacements.push([paths.workspaceDir, "<workspace>"]);
  }
  if (paths.homeDir) {
    replacements.push([paths.homeDir, "~"]);
  }
  for (const [from, to] of replacements.toSorted((a, b) => b[0].length - a[0].length)) {
    out = out.split(from).join(to);
  }
  return out;
}

export type TrunkTemplateParse =
  | { ok: true; template: TrunkTemplate; warnings: string[] }
  | { ok: false; error: string };

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks the shape of a template file. Unknown toolsets and malformed skill ids warn; they do not fail. */
export function parseTrunkTemplate(raw: unknown): TrunkTemplateParse {
  if (!isStringRecord(raw) || raw.format !== TRUNK_TEMPLATE_FORMAT || raw.version !== TRUNK_TEMPLATE_VERSION) {
    return { ok: false, error: `Not a Trunk template: expected format "${TRUNK_TEMPLATE_FORMAT}" version ${TRUNK_TEMPLATE_VERSION}.` };
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { ok: false, error: "Trunk template needs a name." };
  }
  if (!isStringRecord(raw.persona) || typeof raw.persona.agentsMd !== "string") {
    return { ok: false, error: "Trunk template needs persona.agentsMd text." };
  }
  if (!Array.isArray(raw.skills) || !raw.skills.every((id) => typeof id === "string")) {
    return { ok: false, error: "Trunk template skills must be a list of catalog ids." };
  }
  if (!isStringRecord(raw.toolsets)) {
    return { ok: false, error: "Trunk template toolsets must be an object." };
  }
  const warnings: string[] = [];
  const toolsets: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(raw.toolsets)) {
    if (typeof on !== "boolean") {
      warnings.push(`Toolset "${id}" must be true or false and was skipped.`);
      continue;
    }
    toolsets[id] = on;
  }
  const skills = raw.skills.filter((id) => {
    const ok = skillSlugForId(id) !== undefined;
    if (!ok) {
      warnings.push(`Skill "${id}" is not a catalog id and was skipped.`);
    }
    return ok;
  });
  const template = buildTrunkTemplate({
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    agentsMd: raw.persona.agentsMd,
    soulMd: typeof raw.persona.soulMd === "string" ? raw.persona.soulMd : undefined,
    skillSlugs: skills.map((id) => skillSlugForId(id) ?? ""),
    toolsets,
    modelFamily: isStringRecord(raw.model) && typeof raw.model.family === "string" ? raw.model.family : undefined,
    automations: Array.isArray(raw.automations) ? (raw.automations as TrunkTemplateAutomation[]) : undefined,
  });
  return { ok: true, template, warnings };
}

/** Warnings for catalog skills this engine has not installed. The Trunk still gets created without them. */
export function uninstalledSkillWarnings(
  template: TrunkTemplate,
  installedSlugs: ReadonlySet<string>,
): string[] {
  return template.skills.flatMap((id) => {
    const slug = skillSlugForId(id);
    return slug && installedSlugs.has(slug)
      ? []
      : [`Skill "${id}" is not installed here, so this Trunk starts without it.`];
  });
}
