/**
 * Trunk templates: a shareable, secret-free recipe for a Trunk, stored as
 * branch.trunk-template.json. Pure data and functions. The exporter reads a Trunk and
 * hands only the fields below to buildTrunkTemplate, so nothing else can leave.
 */
import { ALWAYS_ON_TOOL_IDS, listToolsetIds, TOOLSETS } from "../agents/tool-toolsets.js";

export const TRUNK_TEMPLATE_FILE_NAME = "branch.trunk-template.json";
export const TRUNK_TEMPLATE_FORMAT = "branch.trunk-template";
export const TRUNK_TEMPLATE_VERSION = 1;

const SEEDBANK_SKILL_PREFIX = "seedbank:@branch-agent/";
const SKILL_ID_PATTERN = /^seedbank:@branch-agent\/([a-z0-9][a-z0-9-]*)(?:@\S+)?$/;
const MODEL_FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A face from the built-in look set ("branch:<look>") or the classic pebble. Never a path or URL. */
const LOOK_PATTERN = /^(?:classic|branch:[a-z][a-z0-9-]{0,31})$/;
const PEM_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const PEM_HEADER_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g;
const WINDOWS_USER_PATH_PATTERN = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`]+/g;
const MAC_USER_PATH_PATTERN = /\/Users\/[^/\s"'`]+/g;
const LINUX_HOME_PATH_PATTERN = /\/home\/[^/\s"'`]+/g;
export const NO_RESTRICTIONS_PERMISSION =
  "This template sets no tool restrictions. Tool switches are set per Trunk after creating it.";

export type TrunkTemplateAutomation = { name: string; cron: string; prompt: string };

export type TrunkTemplate = {
  format: typeof TRUNK_TEMPLATE_FORMAT;
  version: typeof TRUNK_TEMPLATE_VERSION;
  name: string;
  description: string;
  persona: { agentsMd: string; soulMd?: string };
  /** Catalog ids, `seedbank:@branch-agent/<slug>` with an optional `@version`. */
  skills: string[];
  /** Named toolset switches carried by the file, applied to the new Trunk on create. */
  toolsets: Record<string, boolean>;
  /** A model family such as "gpt-5.5". Never an account, key or auth profile. */
  model?: { family: string };
  automations?: TrunkTemplateAutomation[];
  /** What the Trunk may reach, in plain words, as the exporter found it. */
  permissions: string[];
  /** The face it starts with: "branch:<look>" from the built-in look set, or "classic". */
  look?: string;
  /** Built-in tools this Trunk never gets, on top of its toolset switches. */
  denyTools?: string[];
  /**
   * Keeps the Trunk on Ask first even when Full access is on elsewhere: its file tools stay inside
   * its own workspace, so every change it asks Branch to make waits for the owner.
   */
  askFirst?: true;
  /** One of the day-one templates shown in Seedbank > Agents and in the first-run Trunk step. */
  dayOne?: true;
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
  permissions?: string[];
  look?: string;
  denyTools?: string[];
  askFirst?: boolean;
  dayOne?: boolean;
};

export function skillIdForSlug(slug: string): string {
  return `${SEEDBANK_SKILL_PREFIX}${slug}`;
}

/** The bare slug a catalog skill id installs under, or undefined for a malformed id. */
export function skillSlugForId(id: string): string | undefined {
  return SKILL_ID_PATTERN.exec(id)?.[1];
}

/**
 * The one skill check, shared by export and import. Keeps each well-formed catalog id once
 * and names every other entry in a warning. Never fails.
 */
export function validateSkillIds(ids: readonly string[]): { ids: string[]; warnings: string[] } {
  const kept = new Set<string>();
  const warnings: string[] = [];
  for (const id of ids) {
    if (skillSlugForId(id) === undefined) {
      warnings.push("One skill entry is not a catalog id and was skipped.");
    } else {
      kept.add(id);
    }
  }
  return { ids: [...kept], warnings };
}

/** Keeps explicit boolean switches only. Names are checked in parseTrunkTemplate. */
function toolsetSwitches(toolsets: Record<string, boolean> | undefined): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(toolsets ?? {}).filter((pair): pair is [string, boolean] => typeof pair[1] === "boolean"),
  );
}

/** Shapes a template from the allowlisted source. Persona text must already be redacted and scanned. */
export function buildTrunkTemplate(source: TrunkTemplateSource): {
  template: TrunkTemplate;
  warnings: string[];
} {
  const skills = validateSkillIds((source.skillSlugs ?? []).map(skillIdForSlug));
  const modelFamily = source.modelFamily && MODEL_FAMILY_PATTERN.test(source.modelFamily) ? source.modelFamily : undefined;
  if (source.modelFamily && !modelFamily) {
    skills.warnings.push("The model family was not a plain model name and was skipped.");
  }
  const template: TrunkTemplate = {
    format: TRUNK_TEMPLATE_FORMAT,
    version: TRUNK_TEMPLATE_VERSION,
    name: source.name.trim(),
    description: source.description?.trim() ?? "",
    persona: {
      agentsMd: source.agentsMd ?? "",
      ...(source.soulMd ? { soulMd: source.soulMd } : {}),
    },
    skills: skills.ids,
    toolsets: toolsetSwitches(source.toolsets),
    ...(modelFamily ? { model: { family: modelFamily } } : {}),
    ...(source.automations?.length ? { automations: source.automations } : {}),
    permissions: source.permissions?.length ? source.permissions : [NO_RESTRICTIONS_PERMISSION],
    ...(source.look ? { look: source.look } : {}),
    ...(source.denyTools?.length ? { denyTools: [...new Set(source.denyTools)] } : {}),
    ...(source.askFirst === true ? { askFirst: true as const } : {}),
    ...(source.dayOne === true ? { dayOne: true as const } : {}),
  };
  return { template, warnings: skills.warnings };
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
  return out
    .replace(PEM_BLOCK_PATTERN, "<redacted key>")
    .replace(PEM_HEADER_PATTERN, "<redacted key header>")
    .replace(WINDOWS_USER_PATH_PATTERN, "~")
    .replace(MAC_USER_PATH_PATTERN, "~")
    .replace(LINUX_HOME_PATH_PATTERN, "~");
}

export type TrunkTemplateParse =
  | { ok: true; template: TrunkTemplate; warnings: string[] }
  | { ok: false; error: string };

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every built-in tool id a template may name in denyTools. */
function knownToolIds(): Set<string> {
  return new Set([...ALWAYS_ON_TOOL_IDS, ...TOOLSETS.flatMap((toolset) => toolset.tools)]);
}

/** The optional look, deny list and flags. Anything malformed warns and is skipped. */
function parseExtras(raw: Record<string, unknown>, warnings: string[]) {
  let look: string | undefined;
  if (raw.look !== undefined) {
    if (typeof raw.look === "string" && LOOK_PATTERN.test(raw.look)) {
      look = raw.look;
    } else {
      warnings.push("The look is not a face from the built-in look set and was skipped.");
    }
  }
  const denyTools: string[] = [];
  if (raw.denyTools !== undefined) {
    const known = knownToolIds();
    const entries = Array.isArray(raw.denyTools) ? (raw.denyTools as unknown[]) : [raw.denyTools];
    for (const id of entries) {
      if (typeof id === "string" && known.has(id)) {
        denyTools.push(id);
      } else {
        warnings.push("One denied tool names no built-in tool and was skipped.");
      }
    }
  }
  for (const flag of ["askFirst", "dayOne"] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") {
      warnings.push(`The ${flag} flag is not a boolean and was skipped.`);
    }
  }
  return { look, denyTools, askFirst: raw.askFirst === true, dayOne: raw.dayOne === true };
}

/** Checks the shape of a template file. Bad toolsets and malformed skill ids warn; they do not fail. */
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
  const known = new Set(listToolsetIds());
  for (const [id, on] of Object.entries(raw.toolsets)) {
    if (typeof on !== "boolean") {
      warnings.push("One toolset switch is not true or false and was skipped.");
    } else if (ALWAYS_ON_TOOL_IDS.includes(id)) {
      warnings.push("One toolset switch is for a tool that is always on and was skipped.");
    } else if (!known.has(id)) {
      warnings.push("One toolset switch names no known toolset and was skipped.");
    } else {
      toolsets[id] = on;
    }
  }
  const skills = validateSkillIds(raw.skills as string[]);
  warnings.push(...skills.warnings);
  const extras = parseExtras(raw, warnings);
  const built = buildTrunkTemplate({
    ...extras,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    agentsMd: raw.persona.agentsMd,
    soulMd: typeof raw.persona.soulMd === "string" ? raw.persona.soulMd : undefined,
    skillSlugs: skills.ids.map((id) => skillSlugForId(id) ?? ""),
    toolsets,
    modelFamily: isStringRecord(raw.model) && typeof raw.model.family === "string" ? raw.model.family : undefined,
    automations: Array.isArray(raw.automations) ? (raw.automations as TrunkTemplateAutomation[]) : undefined,
    permissions: Array.isArray(raw.permissions) && raw.permissions.every((line) => typeof line === "string")
      ? (raw.permissions as string[])
      : undefined,
  });
  warnings.push(...built.warnings);
  return { ok: true, template: built.template, warnings };
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
