// Gateway RPCs for Trunk templates: export one Trunk, or create a Trunk from a template.
// Both methods respond exactly once, including when something throws.
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCodes, errorShape, validateTrunkTemplateCreateParams, validateTrunkTemplateExportParams } from "../../../packages/gateway-protocol/src/index.js";
import { mutateConfigFileWithRetry } from "../../config/config.js";
import { redactSensitiveText } from "../../logging/redact.js";
import { resolveBundledSkillsDir } from "../../skills/loading/bundled-dir.js";
import { exportTrunkTemplate } from "../../trunks/trunk-template-export.js";
import {
  parseTrunkTemplate,
  redactPersonaText,
  skillSlugForId,
  TRUNK_TEMPLATE_FILE_NAME,
  type TrunkTemplate,
  type TrunkTemplateParse,
  uninstalledSkillWarnings,
} from "../../trunks/trunk-template.js";
import { agentsHandlers } from "./agents.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

const TEMPLATE_SUFFIX = ".branch.trunk-template.json";
const CREATE_DID_NOT_RETURN = "agents.create did not return a Trunk.";

/** Passes the first response through and ignores every later one. */
function onceRespond(respond: RespondFn): RespondFn {
  let sent = false;
  return (ok, payload, error) => {
    if (sent) {
      return;
    }
    sent = true;
    respond(ok, payload, error);
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Trunk exists but the template did not finish applying. Names the agent and workspace so the owner
 * can find it and a retry does not create a duplicate. The reason is scrubbed of local paths and secrets.
 */
function settingsFailureShape(agentId: string, workspace: string, error: unknown) {
  const reason = redactSensitiveText(redactPersonaText(messageOf(error), {}));
  return errorShape(
    ErrorCodes.UNAVAILABLE,
    `The Trunk was created as agent "${agentId}" in ${workspace}, but its template files or settings could not be applied. Do not run the create again, because it would make a second Trunk. Reason: ${reason}`,
    { details: { agentId, workspace } },
  );
}

const TEMPLATE_PATH_SUFFIX = ".trunk-template.json";
const TEMPLATE_FILE_LIMIT_BYTES = 256 * 1024;

type TemplateSource = { ok: true; text: string } | { ok: false; error: string } | undefined;

/** Bundled ids and absolute template paths only. Paths need the template suffix and stay under the size cap. */
async function loadTemplateSource(params: { templateId?: string; templatePath?: string }): Promise<TemplateSource> {
  if (params.templateId) {
    const dir = resolveBundledSkillsDir();
    if (!dir || /[\\/]/.test(params.templateId)) {
      return undefined;
    }
    const text = await readFile(path.join(dir, "trunk-templates", `${params.templateId}${TEMPLATE_SUFFIX}`), "utf8").catch(() => undefined);
    return text === undefined ? undefined : { ok: true, text };
  }
  if (!params.templatePath || !path.isAbsolute(params.templatePath)) {
    return undefined;
  }
  if (!params.templatePath.endsWith(TEMPLATE_PATH_SUFFIX)) {
    return { ok: false, error: `A template file must end with ${TEMPLATE_PATH_SUFFIX}.` };
  }
  const size = await stat(params.templatePath).then((info) => info.size).catch(() => undefined);
  if (size === undefined) {
    return undefined;
  }
  if (size > TEMPLATE_FILE_LIMIT_BYTES) {
    return { ok: false, error: "The template file is larger than 256 KB." };
  }
  const text = await readFile(params.templatePath, "utf8").catch(() => undefined);
  return text === undefined ? undefined : { ok: true, text };
}

function parseTemplateText(text: string): TrunkTemplateParse | undefined {
  try {
    return parseTrunkTemplate(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** What the create still leaves to the owner: the model choice, and automations, which are not created here. */
function notAppliedWarnings(template: TrunkTemplate): string[] {
  const warnings: string[] = [];
  if (template.model) {
    warnings.push(`Model family "${template.model.family}" was not set. Pick a model for this Trunk in its settings.`);
  }
  if (template.automations?.length) {
    warnings.push("Automations in this template were not created. Add them in Automations after creating the Trunk.");
  }
  return warnings;
}

/** Skill folders this engine can load: bundled, and the new Trunk's own workspace. */
function installedSkillSlugs(slugs: readonly string[], workspaceDir: string): Set<string> {
  const roots = [resolveBundledSkillsDir(), path.join(workspaceDir, "skills")].filter(
    (root): root is string => root !== undefined,
  );
  return new Set(slugs.filter((slug) => roots.some((root) => existsSync(path.join(root, slug, "SKILL.md")))));
}

/**
 * Writes the template's toolset switches and attaches its skills to the new Trunk's entry.
 * A skill only needs an entry when the shared defaults already filter skills; otherwise every
 * installed skill is visible. Returns warnings for skills this engine does not have.
 */
async function applyTemplateSettings(agentId: string, template: TrunkTemplate, workspaceDir: string): Promise<string[]> {
  const slugs = template.skills.map(skillSlugForId).filter((slug): slug is string => slug !== undefined);
  const installed = installedSkillSlugs(slugs, workspaceDir);
  const toolsets = { ...template.toolsets };
  if (Object.keys(toolsets).length > 0 || slugs.length > 0) {
    await mutateConfigFileWithRetry({
      afterWrite: { mode: "auto" },
      mutate: (draft) => {
        const agents = (draft.agents ??= {});
        const entries = (agents.entries ??= {});
        const entry = (entries[agentId] ??= {});
        if (Object.keys(toolsets).length > 0) {
          entry.toolsets = toolsets;
        }
        const defaultSkills = agents.defaults?.skills;
        if (slugs.length > 0 && Array.isArray(defaultSkills)) {
          entry.skills = [...new Set([...defaultSkills, ...slugs])];
        }
      },
    });
  }
  return uninstalledSkillWarnings(template, installed);
}

async function writePersona(workspaceDir: string, template: TrunkTemplate): Promise<void> {
  await mkdir(workspaceDir, { recursive: true });
  if (template.persona.agentsMd) {
    await writeFile(path.join(workspaceDir, "AGENTS.md"), template.persona.agentsMd, "utf8");
  }
  if (template.persona.soulMd) {
    await writeFile(path.join(workspaceDir, "SOUL.md"), template.persona.soulMd, "utf8");
  }
}

async function createTrunkFromTemplate(
  options: GatewayRequestHandlerOptions,
  respond: RespondFn,
): Promise<void> {
  const { params } = options;
  const source = await loadTemplateSource(params);
  if (source?.ok === false) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, source.error));
    return;
  }
  const parsed = source === undefined ? undefined : parseTemplateText(source.text);
  if (!parsed) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Trunk template not found or not JSON. Give a bundled templateId or an absolute templatePath."));
    return;
  }
  if (!parsed.ok) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsed.error));
    return;
  }
  const createHandler = agentsHandlers["agents.create"];
  if (!createHandler) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "agents.create is not available."));
    return;
  }
  const outcome: { agentId?: string; workspace?: string } = {};
  const capture: RespondFn = (ok, payload, error) => {
    if (ok) {
      const created = payload as { agentId?: string; workspace?: string } | undefined;
      outcome.agentId = created?.agentId;
      outcome.workspace = created?.workspace;
    } else {
      respond(false, undefined, error);
    }
  };
  await createHandler({ ...options, params: { name: params.name ?? parsed.template.name }, respond: capture });
  if (!outcome.agentId) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, CREATE_DID_NOT_RETURN));
    return;
  }
  const workspace = outcome.workspace ?? "";
  let settingsWarnings: string[];
  try {
    await writePersona(workspace, parsed.template);
    settingsWarnings = await applyTemplateSettings(outcome.agentId, parsed.template, workspace);
  } catch (error) {
    respond(false, undefined, settingsFailureShape(outcome.agentId, workspace, error));
    return;
  }
  respond(true, { ok: true, agentId: outcome.agentId, workspace, warnings: [...parsed.warnings, ...settingsWarnings, ...notAppliedWarnings(parsed.template)] }, undefined);
}

export const trunkTemplatesHandlers: GatewayRequestHandlers = {
  "trunks.template.export": async (options) => {
    const respond = onceRespond(options.respond);
    const { params } = options;
    if (!assertValidParams(params, validateTrunkTemplateExportParams, "trunks.template.export", respond)) {
      return;
    }
    try {
      const result = await exportTrunkTemplate({ cfg: options.context.getRuntimeConfig(), agentId: params.agentId });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      respond(true, { file: TRUNK_TEMPLATE_FILE_NAME, template: result.template, warnings: result.warnings }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
    }
  },
  "trunks.template.create": async (options) => {
    const respond = onceRespond(options.respond);
    const { params } = options;
    if (!assertValidParams(params, validateTrunkTemplateCreateParams, "trunks.template.create", respond)) {
      return;
    }
    try {
      await createTrunkFromTemplate({ ...options, respond }, respond);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
    }
  },
};
