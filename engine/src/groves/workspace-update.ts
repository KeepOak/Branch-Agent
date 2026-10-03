import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { root as fsSafeRoot } from "../infra/fs-safe.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { groveWorkspaceActionsById } from "./application-provenance.js";
import type { GroveAddPlan } from "./types.js";
import type { GroveUpdatePlan } from "./update-plan.js";
import { collectGroveRollbackFailures } from "./update-rollback.js";
import {
  GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
  deleteGroveWorkspaceFileRecord,
  readGroveWorkspaceFiles,
  readGroveWorkspaceActionSource,
  upsertGroveWorkspaceFile,
  type PersistedGroveWorkspaceFile,
} from "./workspace.js";

const MAX_UPDATE_FILE_BYTES = 1024 * 1024;

export type GroveWorkspaceUpdateExecution = {
  appliedPaths: string[];
  rollback: () => Promise<void>;
};

export class GroveWorkspaceUpdateError extends Error {
  constructor(
    message: string,
    readonly partial = false,
  ) {
    super(message);
    this.name = "GroveWorkspaceUpdateError";
  }
}

function digest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function applyGroveWorkspaceUpdate(
  updatePlan: GroveUpdatePlan,
  targetAddPlan: GroveAddPlan,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): Promise<GroveWorkspaceUpdateExecution> {
  const actions = updatePlan.actions.filter(
    (action) => action.kind === "workspaceFile" && action.action !== "unchanged",
  );
  if (actions.length === 0) {
    return { appliedPaths: [], rollback: async () => undefined };
  }
  const workspaceRoot = resolve(targetAddPlan.agent.workspace);
  const packageRoot = resolve(targetAddPlan.grove.packageRoot);
  const workspace = await fsSafeRoot(workspaceRoot, {
    hardlinks: "reject",
    maxBytes: MAX_UPDATE_FILE_BYTES,
    symlinks: "reject",
  });
  const source = await fsSafeRoot(packageRoot, {
    hardlinks: "reject",
    maxBytes: MAX_UPDATE_FILE_BYTES,
    symlinks: "reject",
  });
  const currentRefs = new Map(
    readGroveWorkspaceFiles(updatePlan.agentId, options).map((record) => [record.path, record]),
  );
  const targetActions = groveWorkspaceActionsById(targetAddPlan.actions);
  const undo: Array<() => Promise<void>> = [];
  const appliedPaths: string[] = [];

  const rollback = async () => {
    const failures = await collectGroveRollbackFailures(undo.toReversed());
    if (failures.length > 0) {
      throw new GroveWorkspaceUpdateError(failures.join("; "), true);
    }
  };

  try {
    for (const action of actions) {
      const path = action.id;
      const previousRef = currentRefs.get(path);
      const existed = await workspace.exists(path);
      const previousContent = existed
        ? await workspace.readBytes(path, { maxBytes: MAX_UPDATE_FILE_BYTES })
        : undefined;
      if (action.currentPresent === true && !existed) {
        throw new GroveWorkspaceUpdateError(
          `Workspace file ${JSON.stringify(path)} disappeared after planning.`,
        );
      }
      if (action.currentPresent === false && existed) {
        throw new GroveWorkspaceUpdateError(
          `Workspace file ${JSON.stringify(path)} appeared after planning.`,
        );
      }
      if (
        previousContent &&
        action.currentDigest &&
        digest(previousContent) !== action.currentDigest
      ) {
        throw new GroveWorkspaceUpdateError(
          `Workspace file ${JSON.stringify(path)} changed after planning.`,
        );
      }
      if (action.action === "add" && existed) {
        throw new GroveWorkspaceUpdateError(
          `Workspace destination ${JSON.stringify(path)} appeared after planning.`,
        );
      }

      if (action.action === "remove") {
        undo.push(async () => {
          if (await workspace.exists(path)) {
            throw new Error(`Workspace file ${JSON.stringify(path)} appeared before rollback.`);
          }
          if (previousContent) {
            await workspace.write(path, previousContent, { mkdir: true, overwrite: true });
          }
          if (previousRef) {
            upsertGroveWorkspaceFile(previousRef, options);
          }
        });
        if (existed) {
          await workspace.remove(path);
        }
        deleteGroveWorkspaceFileRecord(updatePlan.agentId, path, options);
        appliedPaths.push(path);
        continue;
      }

      const target = targetActions.get(path);
      if (!target?.source || !target.digest) {
        throw new GroveWorkspaceUpdateError(
          `Target workspace action ${JSON.stringify(path)} lacks source provenance.`,
        );
      }
      const resolvedSource = await readGroveWorkspaceActionSource({
        action: target,
        packageRoot,
        sourceRoot: source,
      });
      const content = resolvedSource.content;
      if (digest(content) !== target.digest || target.digest !== action.desiredDigest) {
        throw new GroveWorkspaceUpdateError(
          `Workspace source for ${JSON.stringify(path)} changed after planning.`,
        );
      }
      const nowMs = options.nowMs ?? Date.now();
      const record: PersistedGroveWorkspaceFile = {
        schemaVersion: GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
        agentId: updatePlan.agentId,
        workspace: workspace.rootReal,
        path,
        sourcePath: resolvedSource.sourceRelative.replaceAll(sep, "/"),
        contentDigest: target.digest,
        status: "complete",
        createdAtMs: previousRef?.createdAtMs ?? nowMs,
        updatedAtMs: nowMs,
      };
      undo.push(async () => {
        if (!(await workspace.exists(path))) {
          throw new Error(`Workspace file ${JSON.stringify(path)} disappeared before rollback.`);
        }
        const currentContent = await workspace.readBytes(path, {
          maxBytes: MAX_UPDATE_FILE_BYTES,
        });
        if (digest(currentContent) !== target.digest) {
          throw new Error(`Workspace file ${JSON.stringify(path)} changed before rollback.`);
        }
        if (previousContent) {
          await workspace.write(path, previousContent, { mkdir: true, overwrite: true });
        } else if (await workspace.exists(path)) {
          await workspace.remove(path);
        }
        if (previousRef) {
          upsertGroveWorkspaceFile(previousRef, options);
        } else {
          deleteGroveWorkspaceFileRecord(updatePlan.agentId, path, options);
        }
      });
      await workspace.write(path, content, { mkdir: true, overwrite: existed });
      upsertGroveWorkspaceFile(record, options);
      appliedPaths.push(path);
    }
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new GroveWorkspaceUpdateError(
        `${coerceErrorMessage(error)}; rollback failed: ${coerceErrorMessage(rollbackError)}`,
        true,
      );
    }
    throw error;
  }
  return { appliedPaths, rollback };
}
