// Gateway RPCs for Trunk templates: export one Trunk, or create a Trunk from a template.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ErrorCodes, errorShape, validateTrunkTemplateCreateParams, validateTrunkTemplateExportParams } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { exportTrunkTemplate } from "../../trunks/trunk-template-export.js";
import {
  parseTrunkTemplate,
  TRUNK_TEMPLATE_FILE_NAME,
  type TrunkTemplate,
} from "../../trunks/trunk-template.js";
import { resolveBundledSkillsDir } from "../../skills/loading/bundled-dir.js";
import { agentsHandlers } from "./agents.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

const TEMPLATE_SUFFIX = ".branch.trunk-template.json";

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

function parseTemplateText(text: string): ReturnType<typeof parseTrunkTemplate> | undefined {
  try {
    return parseTrunkTemplate(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function notAppliedWarnings(template: TrunkTemplate): string[] {
  const warnings: string[] = [];
  if (template.model) {
    warnings.push(`Model family "${template.model.family}" was not set. Pick a model for this Trunk in its settings.`);
  }
  for (const id of template.skills) {
    warnings.push(`Skill "${id}" was not attached. Attach it from the skills page.`);
  }
  if (Object.keys(template.toolsets).length) {
    warnings.push("Toolset switches in this template were not applied in this build.");
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

export const trunkTemplatesHandlers: GatewayRequestHandlers = {
  "trunks.template.export": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateTrunkTemplateExportParams, "trunks.template.export", respond)) {
      return;
    }
    const template = await exportTrunkTemplate({ cfg: context.getRuntimeConfig(), agentId: params.agentId });
    if (!template) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `Trunk "${params.agentId}" was not found.`));
      return;
    }
    respond(true, { file: TRUNK_TEMPLATE_FILE_NAME, template }, undefined);
  },
  "trunks.template.create": async (options) => {
    const { params, respond, context } = options;
    if (!assertValidParams(params, validateTrunkTemplateCreateParams, "trunks.template.create", respond)) {
      return;
    }
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
    const { template } = parsed;
    const outcome: { agentId?: string } = {};
    const capture: RespondFn = (ok, payload, error) => {
      if (ok) {
        outcome.agentId = (payload as { agentId?: string } | undefined)?.agentId;
      } else {
        respond(false, undefined, error);
      }
    };
    const createOptions: GatewayRequestHandlerOptions = { ...options, params: { name: params.name ?? template.name }, respond: capture };
    const createHandler = agentsHandlers["agents.create"];
    if (!createHandler) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "agents.create is not available."));
      return;
    }
    await createHandler(createOptions);
    if (!outcome.agentId) {
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(context.getRuntimeConfig(), outcome.agentId);
    await writePersona(workspaceDir, template);
    respond(true, { ok: true, agentId: outcome.agentId, warnings: [...parsed.warnings, ...notAppliedWarnings(template)] }, undefined);
  },
};
