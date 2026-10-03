import type { BranchStateLeaseIdentity } from "../state/branch-state-lease.types.js";
import type {
  ProjectRegistryIdentity,
  ProjectRegistryInsert,
  ProjectRegistryRecord,
} from "./project-registry.kernel.js";

export type ProjectCheckoutLeaseInput<TProject> = {
  project: TProject;
  lease: BranchStateLeaseIdentity;
};

export type ProjectRegistryWorkerOperations = {
  "projects.findRoot": { input: { repoRoot: string }; output: string | undefined };
  "projects.list": { input: undefined; output: ProjectRegistryRecord[] };
  "projects.resolve": { input: { id: string }; output: ProjectRegistryRecord | undefined };
  "projects.insert": {
    input: ProjectCheckoutLeaseInput<ProjectRegistryInsert>;
    output: ProjectRegistryRecord;
  };
  "projects.remove": { input: ProjectCheckoutLeaseInput<ProjectRegistryIdentity>; output: boolean };
  "projects.resolveRefreshOwner": {
    input: ProjectCheckoutLeaseInput<ProjectRegistryIdentity>;
    output: ProjectRegistryRecord | undefined;
  };
};
