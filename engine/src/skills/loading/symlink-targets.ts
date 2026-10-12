import {
  normalizeTrimmedStringList,
  uniqueStrings,
} from "@branch/normalization-core/string-normalization";
import type { BranchConfig } from "../../config/types.branch.js";
import { safeRealpathSync } from "../../infra/boundary-path.js";
import { resolveUserPath } from "../../utils.js";

export function resolveAllowedSkillSymlinkTargetRealPaths(config?: BranchConfig): string[] {
  const targetPaths = normalizeTrimmedStringList(config?.skills?.load?.allowSymlinkTargets)
    .map((dir) => safeRealpathSync(resolveUserPath(dir)))
    .filter((dir): dir is string => Boolean(dir));
  return uniqueStrings(targetPaths);
}

export const tryRealpath = safeRealpathSync;
