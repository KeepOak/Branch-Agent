import type { SkillLibrarySelection } from "../../../packages/gateway-protocol/src/schema/skill-library.js";
import { executeExistingBranchStateRead } from "../../state/branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "../../state/branch-state-db.js";

export async function readSkillLibrarySelectionDescriptions(
  selections: readonly Pick<SkillLibrarySelection, "skillId" | "revision">[],
  options: Pick<BranchStateDatabaseOptions, "path" | "env">,
) {
  const result = await executeExistingBranchStateRead(options, {
    type: "skills.library.descriptions",
    input: selections.map(({ skillId, revision }) => ({ skillId, revision })),
  });
  if (result === undefined) {
    return undefined;
  }
  if (result.ok && result.type === "skills.library.descriptions") {
    return result.value;
  }
  throw new Error("Unexpected skill library descriptions result");
}

export async function readSkillLibrarySelectionManifests(
  selections: readonly Pick<SkillLibrarySelection, "skillId" | "revision">[],
  options: Pick<BranchStateDatabaseOptions, "path" | "env">,
) {
  if (!selections.length) {
    return [];
  }
  const result = await executeExistingBranchStateRead(options, {
    type: "skills.library.manifests",
    input: selections.map(({ skillId, revision }) => ({ skillId, revision })),
  });
  if (result === undefined) {
    return undefined;
  }
  if (result.ok && result.type === "skills.library.manifests") {
    return result.value;
  }
  throw new Error("Unexpected skill library manifests result");
}
