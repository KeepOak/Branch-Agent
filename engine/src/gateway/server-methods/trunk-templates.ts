// Gateway RPCs for Trunk templates: list the catalog (bundled and imported), export one Trunk as a
// file and a link, or create a Trunk from a template. Every method responds exactly once, including
// when something throws.
// Prior art: Hermes Agent profile export/import and profile distributions (cron jobs arrive paused,
// required connections are checked and shown as set or needing setup), NousResearch/hermes-agent.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ErrorCodes,
  errorShape,
  validateTrunkTemplateCreateParams,
  validateTrunkTemplateExportParams,
  validateTrunkTemplateListParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { mutateConfigFileWithRetry } from "../../config/config.js";
import { resolveStateDir } from "../../config/state-dir.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { redactSensitiveText } from "../../logging/redact.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveBundledSkillsDir } from "../../skills/loading/bundled-dir.js";
import { exportTrunkTemplate } from "../../trunks/trunk-template-export.js";
import {
  decodeTrunkTemplateLink,
  encodeTrunkTemplateLink,
  TRUNK_TEMPLATE_LIMIT_BYTES,
} from "../../trunks/trunk-template-link.js";
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
import { cronHandlers } from "./cron.js";
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
const IMPORTED_PREFIX = "imported:";
const IMPORTED_SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOO_LARGE = "The template is larger than 256 KB.";

/** Where imported templates are kept, so the catalog lists them next to the bundled ones. */
function importedTemplatesDir(): string {
  return path.join(resolveStateDir(), "trunk-templates");
}

/** "Inbox Helper!" -> "inbox-helper". */
export function templateSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug || "template";
}

/**
 * Where a create reads its template. `outside` marks a template that came from a file, a pasted
 * template or a link, which the create keeps in the imported catalog.
 */
type TemplateSource = { ok: true; text: string; outside: boolean } | { ok: false; error: string } | undefined;

async function readCatalogFile(dir: string | undefined, slug: string, suffix: string): Promise<TemplateSource> {
  if (!dir || /[\\/]/.test(slug)) {
    return undefined;
  }
  const text = await readFile(path.join(dir, `${slug}${suffix}`), "utf8").catch(() => undefined);
  return text === undefined ? undefined : { ok: true, text, outside: false };
}

/** A pasted template, a link, a bundled or imported id, or an absolute template path. Paths need the template suffix; all stay under the size cap. */
async function loadTemplateSource(params: {
  template?: unknown;
  link?: string;
  templateId?: string;
  templatePath?: string;
}): Promise<TemplateSource> {
  if (params.template !== undefined) {
    const text = JSON.stringify(params.template);
    return Buffer.byteLength(text, "utf8") > TRUNK_TEMPLATE_LIMIT_BYTES ? { ok: false, error: TOO_LARGE } : { ok: true, text, outside: true };
  }
  if (params.link) {
    const decoded = decodeTrunkTemplateLink(params.link);
    return decoded.ok ? { ok: true, text: JSON.stringify(decoded.value), outside: true } : { ok: false, error: decoded.error };
  }
  if (params.templateId?.startsWith(IMPORTED_PREFIX)) {
    const slug = params.templateId.slice(IMPORTED_PREFIX.length);
    return IMPORTED_SLUG.test(slug) ? readCatalogFile(importedTemplatesDir(), slug, TEMPLATE_SUFFIX) : undefined;
  }
  if (params.templateId) {
    const dir = resolveBundledSkillsDir();
    return readCatalogFile(dir && path.join(dir, "trunk-templates"), params.templateId, TEMPLATE_SUFFIX);
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
  if (size > TRUNK_TEMPLATE_LIMIT_BYTES) {
    return { ok: false, error: "The template file is larger than 256 KB." };
  }
  const text = await readFile(params.templatePath, "utf8").catch(() => undefined);
  return text === undefined ? undefined : { ok: true, text, outside: true };
}

function parseTemplateText(text: string): TrunkTemplateParse | undefined {
  try {
    return parseTrunkTemplate(JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** Keeps an outside template in the imported catalog. A template with the same name is replaced. */
async function saveImportedTemplate(template: TrunkTemplate): Promise<string> {
  const dir = importedTemplatesDir();
  await mkdir(dir, { recursive: true });
  const slug = templateSlug(template.name);
  await writeFile(path.join(dir, `${slug}${TEMPLATE_SUFFIX}`), `${JSON.stringify(template, null, 2)}\n`, "utf8");
  return `${IMPORTED_PREFIX}${slug}`;
}

export type TrunkTemplateCatalogEntry = {
  id: string;
  source: "bundled" | "imported";
  name: string;
  description: string;
  skills: number;
  routines: number;
  connections: string[];
};

async function catalogEntries(dir: string | undefined, source: TrunkTemplateCatalogEntry["source"]): Promise<TrunkTemplateCatalogEntry[]> {
  const names = dir ? await readdir(dir).catch(() => [] as string[]) : [];
  const entries = await Promise.all(
    names.filter((name) => name.endsWith(TEMPLATE_SUFFIX)).toSorted().map(async (name) => {
      const text = await readFile(path.join(dir ?? "", name), "utf8").catch(() => undefined);
      const parsed = text === undefined ? undefined : parseTemplateText(text);
      if (!parsed?.ok) {
        return undefined;
      }
      const slug = name.slice(0, -TEMPLATE_SUFFIX.length);
      const { template } = parsed;
      return {
        id: source === "imported" ? `${IMPORTED_PREFIX}${slug}` : slug,
        source,
        name: template.name,
        description: template.description,
        skills: template.skills.length,
        routines: template.automations?.length ?? 0,
        connections: template.connections ?? [],
      };
    }),
  );
  return entries.filter((entry): entry is TrunkTemplateCatalogEntry => entry !== undefined);
}

/** Bundled templates first, then the ones imported on this computer. Unreadable files are left out. */
export async function listTrunkTemplateCatalog(): Promise<TrunkTemplateCatalogEntry[]> {
  const bundledRoot = resolveBundledSkillsDir();
  const bundled = await catalogEntries(bundledRoot && path.join(bundledRoot, "trunk-templates"), "bundled");
  return [...bundled, ...(await catalogEntries(importedTemplatesDir(), "imported"))];
}

/** What the create still leaves to the owner: the model choice. */
function notAppliedWarnings(template: TrunkTemplate): string[] {
  return template.model
    ? [`Model family "${template.model.family}" was not set. Pick a model for this Trunk in its settings.`]
    : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function scrub(text: string): string {
  return redactSensitiveText(redactPersonaText(text, {}));
}

export type AddedRoutine = { id: string; name: string };

/**
 * Adds each routine through cron.add, turned off, so nothing runs until the owner approves it in
 * Automations. A routine cron.add refuses becomes a warning; the Trunk is kept either way.
 */
async function addRoutinesTurnedOff(
  options: GatewayRequestHandlerOptions,
  agentId: string,
  template: TrunkTemplate,
): Promise<{ routines: AddedRoutine[]; warnings: string[] }> {
  const add = cronHandlers["cron.add"];
  const routines: AddedRoutine[] = [];
  const warnings: string[] = [];
  for (const routine of template.automations ?? []) {
    let id = "";
    let failure = add ? "cron.add did not answer." : "Automations are not available on this engine.";
    if (add) {
      const params = {
        name: routine.name,
        agentId,
        enabled: false,
        schedule: { kind: "cron", expr: routine.cron },
        sessionTarget: "isolated",
        wakeMode: "now",
        payload: { kind: "agentTurn", message: routine.prompt },
      };
      try {
        await add({
          ...options,
          params,
          respond: (ok, payload, error) => {
            const answer = record(payload);
            if (ok) {
              const value = answer.id ?? record(answer.job).id;
              id = typeof value === "string" ? value : "";
            } else {
              failure = error?.message ?? "cron.add refused it.";
            }
          },
        });
      } catch (error) {
        failure = messageOf(error);
      }
    }
    if (id) {
      routines.push({ id, name: routine.name });
    } else {
      warnings.push(`Routine "${routine.name}" could not be added: ${scrub(failure)}`);
    }
  }
  return { routines, warnings };
}

export type ConnectionStatus = { id: string; ready: boolean };

/** Each channel the template names, and whether this computer has it set up. */
function connectionStatus(cfg: BranchConfig, template: TrunkTemplate): ConnectionStatus[] {
  const channels = record(cfg.channels);
  return (template.connections ?? []).map((id) => {
    const channel = channels[id];
    return { id, ready: typeof channel === "object" && channel !== null && record(channel).enabled !== false };
  });
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
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Trunk template not found or not JSON. Give a catalog templateId, a template, a link, or an absolute templatePath."));
    return;
  }
  if (!parsed.ok) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, parsed.error));
    return;
  }
  const saved = source?.ok && source.outside
    ? await saveImportedTemplate(parsed.template).then(
        (id) => ({ id, warnings: [] as string[] }),
        (error: unknown) => ({ id: undefined, warnings: [`The template could not be kept in the catalog: ${scrub(messageOf(error))}`] }),
      )
    : { id: undefined, warnings: [] as string[] };
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
  const added = await addRoutinesTurnedOff(options, outcome.agentId, parsed.template);
  respond(
    true,
    {
      ok: true,
      agentId: outcome.agentId,
      name: params.name ?? parsed.template.name,
      workspace,
      ...(saved.id ? { templateId: saved.id } : {}),
      routines: added.routines,
      connections: connectionStatus(options.context.getRuntimeConfig(), parsed.template),
      warnings: [...parsed.warnings, ...saved.warnings, ...settingsWarnings, ...added.warnings, ...notAppliedWarnings(parsed.template)],
    },
    undefined,
  );
}

const ROUTINE_PAGE = 200;

/** Every scheduled job for one Trunk, read through cron.list so its caller scope and visibility rules apply. */
async function listTrunkRoutines(options: GatewayRequestHandlerOptions, agentId: string): Promise<unknown[]> {
  const list = cronHandlers["cron.list"];
  if (!list) {
    return [];
  }
  const jobs: unknown[] = [];
  const owner = normalizeAgentId(agentId);
  let offset = 0;
  for (;;) {
    let page: Record<string, unknown> | undefined;
    let failure = "cron.list did not answer.";
    await list({
      ...options,
      params: { agentId, includeDisabled: true, limit: ROUTINE_PAGE, offset, includeDeliveryPreviews: false },
      respond: (ok, payload, error) => {
        if (ok) {
          page = record(payload);
        } else {
          failure = error?.message ?? "cron.list refused.";
        }
      },
    });
    if (!page) {
      throw new Error(`This Trunk's routines could not be read: ${failure}`);
    }
    const rows = Array.isArray(page.jobs) ? page.jobs : [];
    jobs.push(...rows.filter((job) => {
      const effective = record(job).effectiveAgentId;
      return typeof effective !== "string" || effective === owner;
    }));
    if (page.hasMore !== true || typeof page.nextOffset !== "number") {
      return jobs;
    }
    offset = page.nextOffset;
  }
}

export const trunkTemplatesHandlers: GatewayRequestHandlers = {
  "trunks.template.list": async (options) => {
    const respond = onceRespond(options.respond);
    if (!assertValidParams(options.params, validateTrunkTemplateListParams, "trunks.template.list", respond)) {
      return;
    }
    try {
      respond(true, { templates: await listTrunkTemplateCatalog() }, undefined);
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, messageOf(error)));
    }
  },
  "trunks.template.export": async (options) => {
    const respond = onceRespond(options.respond);
    const { params } = options;
    if (!assertValidParams(params, validateTrunkTemplateExportParams, "trunks.template.export", respond)) {
      return;
    }
    try {
      const cronJobs = await listTrunkRoutines(options, params.agentId);
      const result = await exportTrunkTemplate({ cfg: options.context.getRuntimeConfig(), agentId: params.agentId, cronJobs });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, result.error));
        return;
      }
      const link = encodeTrunkTemplateLink(result.template);
      respond(true, { file: TRUNK_TEMPLATE_FILE_NAME, template: result.template, link, warnings: result.warnings }, undefined);
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
