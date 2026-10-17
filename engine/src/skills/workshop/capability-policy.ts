import type { BranchConfig } from "../../config/types.branch.js";
import { resolveSkillWorkshopConfig } from "./config.js";

/** All non-document support files are tool material, regardless of their folder. */
export function hasWorkshopToolFiles(files: readonly { path: string }[] = []): boolean {
  return files.some((file) => {
    const portable = file.path.replaceAll("\\", "/").toLowerCase();
    return portable.startsWith("scripts/") || !/\.(?:md|txt|rst|csv|json|ya?ml)$/u.test(portable);
  });
}

export function assertWorkshopCapability(
  config: BranchConfig,
  files: readonly { path: string }[] = [],
): void {
  if (resolveSkillWorkshopConfig(config).highestStep === "skill" && hasWorkshopToolFiles(files)) {
    throw new Error("Budding's highest step is A skill. Script-backed tools require Its own tool.");
  }
}
