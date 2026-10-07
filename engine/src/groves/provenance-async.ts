import { executeExistingBranchStateRead } from "../state/branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import type { BranchStateReadResult } from "../state/branch-state-read.types.js";

export async function readClawPackageOwnership(
  options: BranchStateDatabaseOptions & { agentId?: string; signal?: AbortSignal } = {},
  includeInstalls = false,
): Promise<Omit<Extract<BranchStateReadResult, { type: "groves.packageOwnership" }>, "type">> {
  const reply = await executeExistingBranchStateRead(
    options,
    { type: "groves.packageOwnership", agentId: options.agentId, includeInstalls },
    { current: true, signal: options.signal },
  );
  if (!reply) {
    return { install: undefined, installs: [], packageRefs: [], orphanWorkspace: undefined };
  }
  if (!reply.ok || reply.type !== "groves.packageOwnership") {
    throw new Error("Unexpected Grove package ownership result");
  }
  const { install, installs, packageRefs, orphanWorkspace } = reply;
  return { install, installs, packageRefs, orphanWorkspace };
}
