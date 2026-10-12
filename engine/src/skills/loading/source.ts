import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import type { SkillTelemetrySource } from "../types.js";
import type { Skill } from "./skill-contract.js";

/** Returns the stable source label attached to a loaded skill. */
export function resolveSkillSource(skill: Skill): string {
  return (
    normalizeOptionalString(skill.source) ??
    normalizeOptionalString(skill.sourceInfo?.source) ??
    "unknown"
  );
}

export function resolveSkillTelemetrySourceValue(value: unknown): SkillTelemetrySource {
  const source = normalizeOptionalString(value) ?? "";
  if (source === "bundled" || source === "branch-bundled" || source === "branch-custodian") {
    return "bundled";
  }
  if (
    source === "workspace" ||
    source === "branch-workspace" ||
    source === "branch-workshop" ||
    source === "branch-managed" ||
    source === "branch-extra" ||
    source === "agents-skills-personal" ||
    source === "agents-skills-project"
  ) {
    return "workspace";
  }
  return "unknown";
}

export function resolveSkillTelemetrySource(skill: Skill): SkillTelemetrySource {
  return resolveSkillTelemetrySourceValue(resolveSkillSource(skill));
}
