// Removes Seedbank-installed workspace skills after an explicit version check and lifecycle plan.
import {
  ErrorCodes,
  errorShape,
  type SkillsUninstallParams,
  validateSkillsUninstallParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { parseRequestedClawHubSkillRef } from "../../skills/lifecycle/clawhub-store.js";
import {
  applyClawHubSkillUninstall,
  planClawHubSkillUninstall,
} from "../../skills/lifecycle/clawhub-uninstall.js";
import { buildRemoteAwareWorkspaceSkillStatus } from "./skills-status.js";
import {
  resolveSkillsAgentWorkspace,
  type ResolvedSkillsWorkspace,
} from "./skills-workspace-handler.js";
import type { GatewayRequestHandler } from "./types.js";
import { assertValidParams } from "./validation.js";

/** Skill sources owned by Branch itself; the gateway never removes these. */
const PROTECTED_SKILL_SOURCES = new Set(["branch-bundled", "branch-custodian"]);

/**
 * Returns the protected source of a skill matching the slug, if any. A matching name or key in a
 * protected source refuses removal, even when a workspace directory shares the slug.
 */
async function findProtectedSkillSource(
  resolved: ResolvedSkillsWorkspace,
  slug: string,
): Promise<string | undefined> {
  const { report } = await buildRemoteAwareWorkspaceSkillStatus(resolved);
  const match = report.skills.find(
    (skill) =>
      PROTECTED_SKILL_SOURCES.has(skill.source) && (skill.skillKey === slug || skill.name === slug),
  );
  return match?.source;
}

export const handleSkillsUninstall: GatewayRequestHandler = async ({
  params,
  respond,
  context,
}) => {
  if (!assertValidParams(params, validateSkillsUninstallParams, "skills.uninstall", respond)) {
    return;
  }
  const p: SkillsUninstallParams = params;
  const resolved = resolveSkillsAgentWorkspace(p, context);
  if (!resolved.ok) {
    respond(false, undefined, resolved.error);
    return;
  }
  let slug: string;
  try {
    slug = parseRequestedClawHubSkillRef(p.slug).slug;
  } catch (error) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatErrorMessage(error)));
    return;
  }
  const protectedSource = await findProtectedSkillSource(resolved, slug);
  if (protectedSource) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Skill ${JSON.stringify(slug)} is a ${protectedSource} skill and cannot be removed.`,
      ),
    );
    return;
  }
  const planned = await planClawHubSkillUninstall({
    workspaceDir: resolved.workspaceDir,
    slug: p.slug,
    expectedVersion: p.expectedVersion,
  });
  if (!planned.ok) {
    respond(
      false,
      { ok: false, error: planned.error, code: planned.code },
      errorShape(ErrorCodes.UNAVAILABLE, planned.error, { details: { code: planned.code } }),
    );
    return;
  }
  const applied = await applyClawHubSkillUninstall(planned.plan);
  if (!applied.ok) {
    respond(false, applied, errorShape(ErrorCodes.UNAVAILABLE, applied.error));
    return;
  }
  respond(true, {
    ok: true,
    slug,
    version: planned.plan.version,
    message: `Removed ${slug}@${planned.plan.version}`,
  });
};
