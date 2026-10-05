import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES } from "../agents/workspace-bootstrap-read.js";
import { DEFAULT_BOOTSTRAP_FILENAME, seedWorkspaceBootstrap } from "../agents/workspace.js";
import { root as fsSafeRoot } from "../infra/fs-safe.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { digestGroveBytes } from "./digest.js";
import { groveContainedRelativePath } from "./path-containment.js";
import type { GroveAddPlan } from "./types.js";

export class GroveBootstrapWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroveBootstrapWriteError";
  }
}

export async function seedClawPackageBootstrap(
  plan: GroveAddPlan,
  options: {
    nowMs?: number;
    seedBootstrap?: typeof seedWorkspaceBootstrap;
  } & BranchStateDatabaseOptions = {},
): Promise<"seeded" | "already-seeded" | "consumed" | undefined> {
  const actions = plan.actions.filter((action) => action.kind === "bootstrap");
  if (actions.length === 0) {
    return undefined;
  }
  if (actions.length !== 1) {
    throw new GroveBootstrapWriteError(
      "bootstrap_plan_invalid",
      "A Grove add plan may contain only one package bootstrap action.",
    );
  }
  const action = actions[0]!;
  if (!action.source || !action.digest) {
    throw new GroveBootstrapWriteError(
      "bootstrap_plan_invalid",
      "The package bootstrap action lacks source integrity.",
    );
  }

  const packageRoot = await realpath(resolve(plan.grove.packageRoot));
  const sourcePath = resolve(action.source);
  const sourceRelative = groveContainedRelativePath(packageRoot, sourcePath);
  if (!sourceRelative) {
    throw new GroveBootstrapWriteError(
      "bootstrap_source_escape",
      "BOOTSTRAP.md must remain inside the Grove package.",
    );
  }
  const sourceRoot = await fsSafeRoot(packageRoot);
  const read = await sourceRoot.read(sourceRelative, {
    hardlinks: "reject",
    maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
    symlinks: "reject",
  });
  if (resolve(read.realPath) !== sourcePath || digestGroveBytes(read.buffer) !== action.digest) {
    throw new GroveBootstrapWriteError(
      "bootstrap_source_changed",
      "BOOTSTRAP.md changed after consent; run add --dry-run again.",
    );
  }

  const expectedTarget = resolve(plan.agent.workspace, DEFAULT_BOOTSTRAP_FILENAME);
  if (resolve(action.target) !== expectedTarget) {
    throw new GroveBootstrapWriteError(
      "bootstrap_target_changed",
      "The package bootstrap target is not the new agent workspace root.",
    );
  }

  return (options.seedBootstrap ?? seedWorkspaceBootstrap)({
    dir: plan.agent.workspace,
    content: read.buffer,
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    stateOptions: options,
  });
}
