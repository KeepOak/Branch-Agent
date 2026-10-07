import {
  GROVE_PACKAGE_LIFECYCLE_LEASE_SCOPE,
  clawPackageLifecycleLeaseKey,
  type ClawPackageLifecycleArtifact,
} from "./grove-package-lifecycle-lease-key.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db.js";
import { withBranchStateLease, type BranchStateLeaseContext } from "./branch-state-lease.js";

// Skill serialization covers a workspace; claims remain bound to its selected artifact.
const artifacts = new WeakMap<BranchStateLeaseContext, ClawPackageLifecycleArtifact>();

export function assertClawPackageLifecycleWriteArtifact(
  lease: BranchStateLeaseContext,
  artifact: Pick<ClawPackageLifecycleArtifact, "kind" | "source" | "ref">,
): void {
  const original = artifacts.get(lease);
  if (
    !original ||
    original.kind !== artifact.kind ||
    original.source !== artifact.source ||
    original.ref !== artifact.ref
  ) {
    throw new Error("Package write requires its original lifecycle owner.");
  }
}

/** Retain shared artifact ownership through asynchronous work and worker settlement. */
export function withClawPackageLifecycleLease<T>(
  artifact: ClawPackageLifecycleArtifact,
  operation: (lease: BranchStateLeaseContext) => Promise<T>,
  options: BranchStateDatabaseOptions & { signal?: AbortSignal } = {},
): Promise<T> {
  const capturedArtifact = { ...artifact };
  return withBranchStateLease(
    {
      scope: GROVE_PACKAGE_LIFECYCLE_LEASE_SCOPE,
      key: clawPackageLifecycleLeaseKey(capturedArtifact),
      database: { scope: "shared", options },
      leaseMs: 5 * 60_000,
      waitMs: 0,
      signal: options.signal,
      leaseLabel: "Grove package lifecycle",
      operationLabel: "grove.package.lifecycle",
    },
    (lease) => {
      artifacts.set(lease, capturedArtifact);
      return operation(lease);
    },
  );
}
