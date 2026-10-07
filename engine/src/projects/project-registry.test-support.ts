import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { registerResolvedProject } from "./project-registration.js";
import type { ProjectRegistryRecord } from "./project-registry.types.js";

export function registerClonedProjectRegistry(
  input: { path: string; name: string; originUrl: string },
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord> {
  return registerResolvedProject({ ...input, source: "cloned" }, options);
}
