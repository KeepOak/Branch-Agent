import { assertClawPackageLifecycleWriteArtifact } from "../state/grove-package-lifecycle-lease.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { runWithBranchStateLeaseWorker } from "../state/branch-state-lease-worker-operation.js";
import type { BranchStateLeaseContext } from "../state/branch-state-lease.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { executeBranchStateWorker } from "../state/branch-state-worker-store.js";
import type {
  ClawPackageRefStatus,
  PersistedClawPackageRef,
} from "./package-extension-provenance.js";

export async function claimClawPackageRefStatus(
  ref: PersistedClawPackageRef,
  status: ClawPackageRefStatus,
  options: BranchStateDatabaseOptions & {
    lease: BranchStateLeaseContext;
    nowMs?: number;
    assertCurrent?: () => void;
  },
): Promise<PersistedClawPackageRef> {
  if (options.readOnly) {
    throw new Error("Grove provenance writes require writable state.");
  }
  // Store admission can yield before execute captures the command.
  const capturedRef = structuredClone(ref);
  const nowMs = options.nowMs;
  assertClawPackageLifecycleWriteArtifact(options.lease, capturedRef);
  const assertCaller = options.assertCurrent?.bind(options);
  const context = captureBranchStateWorkerContext({
    ...options,
    path: options.database?.path ?? options.path,
  });
  const assertCurrent = () => {
    context.admission.assertCurrent();
    assertCaller?.();
  };
  const result = await runWithBranchStateLeaseWorker(
    options.lease,
    context,
    (scope, identity) =>
      scope.execute({
        type: "groveProvenance.packageStatus",
        input: { ref: capturedRef, status, nowMs, lease: identity },
      }),
    { assertCurrent },
  );
  assertCurrent();
  return result;
}

export function reconcileGroveMcpServerRefsInWorker(
  agentId: string,
  digests: Record<string, string>,
  options: BranchStateDatabaseOptions & { nowMs?: number },
) {
  if (options.readOnly) {
    throw new Error("Grove provenance writes require writable state.");
  }
  const context = captureBranchStateWorkerContext({
    ...options,
    path: options.database?.path ?? options.path,
  });
  return executeBranchStateWorker(context, {
    type: "groveProvenance.reconcileMcp",
    input: { agentId, digests, nowMs: options.nowMs },
  });
}
