/** Versioned ownership payload for agent state that predates Grove enrollment. */

export const GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION = "branch.groveInstallRecord.v3" as const;

export type GroveAgentOrigin = "created" | "adopted";

type AdoptedAgentPaths = {
  origin: "adopted";
  paths: string[];
};

function isAdoptedAgentPaths(value: unknown): value is AdoptedAgentPaths {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (!("origin" in value) || !("paths" in value)) {
    return false;
  }
  return (
    value.origin === "adopted" &&
    Array.isArray(value.paths) &&
    value.paths.every((path) => typeof path === "string")
  );
}

export function decodeGroveAgentOwnership(
  value: string,
  schemaVersion: string,
): {
  origin: GroveAgentOrigin;
  paths: string[];
} {
  const parsed: unknown = JSON.parse(value);
  if (schemaVersion === GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION) {
    if (!isAdoptedAgentPaths(parsed)) {
      throw new Error("Adopted Grove install record has invalid agent ownership data.");
    }
    return { origin: "adopted", paths: [...parsed.paths] };
  }
  if (
    schemaVersion !== "branch.groveInstallRecord.v1" &&
    schemaVersion !== "branch.groveInstallRecord.v2"
  ) {
    throw new Error(`Unsupported Grove install record schema ${JSON.stringify(schemaVersion)}.`);
  }
  if (!Array.isArray(parsed) || !parsed.every((path) => typeof path === "string")) {
    throw new Error("Created Grove install record has invalid agent ownership data.");
  }
  return { origin: "created", paths: [...parsed] };
}

export function encodeGroveAgentOwnership(
  paths: string[],
  origin: GroveAgentOrigin,
): {
  schemaVersion:
    | "branch.groveInstallRecord.v2"
    | typeof GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION;
  agentOwnedPathsJson: string;
} {
  return origin === "adopted"
    ? {
        schemaVersion: GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION,
        agentOwnedPathsJson: JSON.stringify({ origin, paths }),
      }
    : {
        schemaVersion: "branch.groveInstallRecord.v2",
        agentOwnedPathsJson: JSON.stringify(paths),
      };
}
