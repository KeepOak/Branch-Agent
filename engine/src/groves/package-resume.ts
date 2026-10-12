import { stableStringify } from "@branch/normalization-core";
import { normalizeClawHubSha256Integrity } from "../infra/clawhub-integrity.js";
import {
  openExistingBranchStateDatabaseReadOnly,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { readGroveInstallRecordFromDatabase } from "./provenance-read.kernel.js";
import {
  readClawPackageRefs,
  type PersistedGroveInstall,
  type PersistedClawPackageRef,
} from "./provenance.js";
import type { ClawPackage, ClawPackagePreflightResult } from "./types.js";

export function ownerInstallIsNewerThanRefs(
  installedAt: string | undefined,
  refs: readonly PersistedClawPackageRef[],
): boolean {
  const timestamp = Date.parse(installedAt ?? "");
  return (
    Number.isFinite(timestamp) &&
    refs.length > 0 &&
    refs.every((ref) => timestamp > ref.updatedAtMs)
  );
}

function persistedExtensionMatchesPreflight(
  ref: PersistedClawPackageRef,
  preflight: ClawPackagePreflightResult,
): boolean {
  if (!ref.extension) {
    return true;
  }
  if (!preflight.ok) {
    return false;
  }
  return (
    stableStringify({
      detectedFormat: ref.extension.detectedFormat,
      mapped: ref.extension.mapped,
      unavailable: ref.extension.unavailable,
      adapterIdentity: ref.extension.adapterIdentity,
    }) ===
    stableStringify({
      detectedFormat: preflight.detectedFormat,
      mapped: preflight.mapped ?? [],
      unavailable: preflight.unavailable ?? [],
      adapterIdentity: preflight.adapterIdentity,
    })
  );
}

export function findResumableIntroducedPluginRequirement(params: {
  agentId: string;
  pkg: ClawPackage;
  preflight: ClawPackagePreflightResult;
  refs: readonly PersistedClawPackageRef[];
  expectedIntegrity?: string;
}): PersistedClawPackageRef | undefined {
  if (params.pkg.kind !== "plugin" || !params.preflight.ok || params.preflight.action !== "reuse") {
    return undefined;
  }
  const expectedRawIntegrity = params.expectedIntegrity ?? params.preflight.integrity;
  if (!expectedRawIntegrity || !params.preflight.installedIntegrity) {
    return undefined;
  }
  const expectedIntegrity = normalizeClawHubSha256Integrity(expectedRawIntegrity);
  const installedIntegrity = normalizeClawHubSha256Integrity(params.preflight.installedIntegrity);
  if (!expectedIntegrity || installedIntegrity !== expectedIntegrity) {
    return undefined;
  }
  const ref = params.refs.find(
    (candidate) =>
      candidate.agentId === params.agentId &&
      candidate.kind === params.pkg.kind &&
      candidate.source === params.pkg.source &&
      candidate.ref === params.pkg.ref &&
      candidate.version === params.pkg.version &&
      normalizeClawHubSha256Integrity(candidate.integrity) === expectedIntegrity &&
      candidate.status === "complete" &&
      candidate.relationship === "referenced" &&
      candidate.origin === "grove-introduced" &&
      !candidate.independentOwner &&
      persistedExtensionMatchesPreflight(candidate, params.preflight),
  );
  return ref && !ownerInstallIsNewerThanRefs(params.preflight.installedAt, [ref]) ? ref : undefined;
}

export async function readGroveResumeStateReadOnly(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): Promise<
  | {
      record: PersistedGroveInstall;
      packageRefs: PersistedClawPackageRef[];
    }
  | undefined
> {
  const database = await openExistingBranchStateDatabaseReadOnly({
    ...options,
    requireCanonicalSchema: true,
  });
  if (!database) {
    return undefined;
  }
  try {
    const record = readGroveInstallRecordFromDatabase(database.db, agentId);
    if (!record) {
      return undefined;
    }
    return {
      record,
      packageRefs: readClawPackageRefs({ ...options, database, readOnly: true, agentId }),
    };
  } finally {
    database.walMaintenance.close();
  }
}
