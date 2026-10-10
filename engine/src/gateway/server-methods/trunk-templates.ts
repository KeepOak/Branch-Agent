// Gateway RPCs for Trunk templates: export one Trunk, or create a Trunk from a template.
// Both methods respond exactly once, including when something throws.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCodes, errorShape, validateTrunkTemplateCreateParams, validateTrunkTemplateExportParams } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { resolveBundledSkillsDir } from "../../skills/loading/bundled-dir.js";
import { exportTrunkTemplate } from "../../trunks/trunk-template-export.js";
import {
  parseTrunkTemplate,
  TRUNK_TEMPLATE_FILE_NAME,
  type TrunkTemplate,
  type TrunkTemplateParse,
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

async function loadTemplateSource(params: { templateId?: string; templatePath?: string }) {
  if (params.templateId) {
    const dir = resolveBundledSkillsDir();
    if (!dir || /[\\/]/.test(params.templateId)) {
      return undefined;
    }
    return readFile(path.join(dir, "trunk-templates", `${params.templateId}${TEMPLATE_SUFFIX}`), "utf8").catch(() => undefined);
  }
  if (params.templatePath && path.isAbsolute(params.templatePath)) {
    return readFile(params.templatePath, "utf8").catch(() => undefined);
  }
  return undefined;
}

function parseTemplateText(text: string): TrunkTemplateParse | undefined {
  try {
    return parseTrunkTemplate(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** What the create does not apply yet, said plainly so the owner can set it after creating the Trunk. */
function notAppliedWarnings(template: TrunkTemplate): string[] {
  const warnings: string[] = [];
  if (template.model) {
    warnings.push(`Model family "${template.model.family}" was not set. Pick a model for this Trunk in its settings.`);
  }
  for (const id of template.skills) {
    warnings.push(`Skill "${id}" was not attached. Attach it from the skills page.`);
  }
  if (Object.keys(template.toolsets).length > 0) {
    warnings.push("Tool switches in this template were not applied. Set them in What it may do.");
  }
  return warnings;
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
  const { params, context } = options;
  const source = await loadTemplateSource(params);
  const parsed = source === undefined ? undefined : parseTemplateText(source);
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
  const outcome: { agentId?: string } = {};
  const capture: RespondFn = (ok, payload, error) => {
    if (ok) {
      outcome.agentId = (payload as { agentId?: string } | undefined)?.agentId;
    } else {
      respond(false, undefined, error);
    }
  };
  await createHandler({ ...options, params: { name: params.name ?? parsed.template.name }, respond: capture });
  if (!outcome.agentId) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, CREATE_DID_NOT_RETURN));
    return;
  }
  await writePersona(resolveAgentWorkspaceDir(context.getRuntimeConfig(), outcome.agentId), parsed.template);
  respond(true, { ok: true, agentId: outcome.agentId, warnings: [...parsed.warnings, ...notAppliedWarnings(parsed.template)] }, undefined);
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
