import { isRecord } from "@branch/normalization-core/record-coerce";

export type BranchSchemaVersions = {
  state: number;
  agent: number;
};

export function parseBranchSchemaVersions(value: unknown): BranchSchemaVersions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { state, agent } = value;
  if (
    typeof state !== "number" ||
    !Number.isInteger(state) ||
    state < 0 ||
    typeof agent !== "number" ||
    !Number.isInteger(agent) ||
    agent < 0
  ) {
    return undefined;
  }
  return { state, agent };
}

export function parsePackageBranchSchemaVersions(
  packageJson: unknown,
): BranchSchemaVersions | undefined {
  if (!isRecord(packageJson)) {
    return undefined;
  }
  const branch = packageJson.branch;
  if (branch !== undefined) {
    if (!isRecord(branch)) {
      return undefined;
    }
    const schemaVersions = branch.schemaVersions;
    if (schemaVersions !== undefined) {
      return parseBranchSchemaVersions(schemaVersions);
    }
  }
  // Published Branch Agent stable releases through 2026.7.1 used schema 1 before
  // declaring it in package metadata. Unknown versions and replacement packages
  // cannot inherit that shipped contract. See database-schemas/integrity-and-recovery.
  if (packageJson.name !== "branch" || typeof packageJson.version !== "string") {
    return undefined;
  }
  const legacy = /^2026\.([1-7])\.([1-9]\d*)$/.exec(packageJson.version);
  if (
    !legacy ||
    !Number.isSafeInteger(Number(legacy[2])) ||
    (legacy[1] === "7" && legacy[2] !== "1")
  ) {
    return undefined;
  }
  return { state: 1, agent: 1 };
}
