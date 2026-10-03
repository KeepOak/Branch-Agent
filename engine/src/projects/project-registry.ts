import fs from "node:fs/promises";
import path from "node:path";
import { withAgentRosterFactsBatch } from "../agents/agent-scope-config.js";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import type { BranchConfig } from "../config/types.branch.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import type { BranchStateLeaseContext } from "../state/branch-state-lease.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { withProjectCheckoutLifecycle } from "./project-checkout.js";
import { registerResolvedProject } from "./project-registration.js";
import {
  ensureProjectRegistrySchema,
  removeProjectCheckoutReferenceInDatabase,
  type ProjectRegistryIdentity,
  type ProjectRegistryRecord,
} from "./project-registry.kernel.js";

export type { ProjectRegistryRecord } from "./project-registry.kernel.js";
export {
  ProjectCheckoutError,
  resolveProjectCheckout,
  resolveProjectDirectory,
} from "./project-checkout.js";

function workspaceProject(cfg: BranchConfig, agentId: string): ProjectRegistryRecord {
  const repoRoot = resolveAgentWorkspaceDir(cfg, agentId);
  return {
    id: `workspace:${agentId}`,
    displayName: path.basename(repoRoot) || agentId,
    repoRoot,
    source: "workspace",
    agentId,
  };
}

function compareProjects(left: ProjectRegistryRecord, right: ProjectRegistryRecord): number {
  const leftName = left.displayName.toLowerCase();
  const rightName = right.displayName.toLowerCase();
  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export async function registerProjectRegistry(
  input: { path: string; name?: string },
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord> {
  return await registerResolvedProject({ ...input, source: "registered" }, options);
}

export function listWorkspaceProjects(cfg: BranchConfig): ProjectRegistryRecord[] {
  return withAgentRosterFactsBatch(cfg, () =>
    listAgentIds(cfg)
      .map((agentId) => workspaceProject(cfg, agentId))
      .toSorted(compareProjects),
  );
}

export async function listProjectRegistry(
  cfg: BranchConfig,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord[]> {
  const context = captureBranchStateWorkerContext(options);
  const workspaces = listWorkspaceProjects(cfg);
  const { executeBranchStateWorker } = await import("../state/branch-state-worker-store.js");
  const stored = await executeBranchStateWorker(context, {
    type: "projects.list",
    input: undefined,
  });
  return [...workspaces, ...stored].toSorted(compareProjects);
}

export function resolveWorkspaceProject(
  cfg: BranchConfig,
  id: string,
): ProjectRegistryRecord | undefined {
  if (!id.startsWith("workspace:")) {
    return undefined;
  }
  const agentId = id.slice("workspace:".length);
  return listAgentIds(cfg).includes(agentId) ? workspaceProject(cfg, agentId) : undefined;
}

export async function resolveProjectRegistry(
  cfg: BranchConfig,
  id: string,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<ProjectRegistryRecord | undefined> {
  if (id.startsWith("workspace:")) {
    return resolveWorkspaceProject(cfg, id);
  }
  const context = captureBranchStateWorkerContext(options);
  return await readStoredProjectRegistry(context, id);
}

async function readStoredProjectRegistry(
  context: BranchStateWorkerContext,
  id: string,
): Promise<ProjectRegistryRecord | undefined> {
  const { executeBranchStateWorker } = await import("../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, { type: "projects.resolve", input: { id } });
}

type ProjectRegistrySelection = {
  project: ProjectRegistryRecord;
  withCurrent: <T>(
    run: (current: {
      project: ProjectRegistryRecord | undefined;
      assertCurrent: () => void;
      assertCheckoutCurrent: () => void;
      signal: AbortSignal;
    }) => T | Promise<T>,
  ) => Promise<T>;
  withRollback: <T>(run: (assertCurrent: () => void) => Promise<T>) => Promise<T>;
};

/** Retain the original database and reacquire the selected checkout for each finite operation. */
export async function selectStoredProjectRegistry(
  id: string,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & { signal?: AbortSignal } = {},
): Promise<ProjectRegistrySelection | undefined> {
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const context = captureBranchStateWorkerContext({ path: options.path, env });
  const signal = options.signal;
  const project = await readStoredProjectRegistry(context, id);
  if (!project) {
    return undefined;
  }
  const repoRoot = project.repoRoot;
  return {
    project,
    withRollback: async (run) =>
      await withProjectCheckoutLifecycle(
        repoRoot,
        { path: context.admission.databasePath, env },
        async (lease) => {
          const { withBranchStateLeaseWorkerAdmission } =
            await import("../state/branch-state-lease-worker-owner.js");
          return await withBranchStateLeaseWorkerAdmission(
            lease,
            context.admission.databasePath,
            async (admission) =>
              await run(() => {
                context.admission.assertCurrent();
                admission.assertCurrent();
              }),
          );
        },
      ),
    withCurrent: async (run) => {
      const acquisition = new AbortController();
      const abortAcquisition = () => acquisition.abort(signal?.reason);
      signal?.addEventListener("abort", abortAcquisition, { once: true });
      if (signal?.aborted) {
        abortAcquisition();
      }
      try {
        return await withProjectCheckoutLifecycle(
          repoRoot,
          { path: context.admission.databasePath, env, signal: acquisition.signal },
          async (lease) => {
            // Cancellation stops new effects; checkout custody also owns their rollback.
            signal?.removeEventListener("abort", abortAcquisition);
            const operationSignal = signal ? AbortSignal.any([signal, lease.signal]) : lease.signal;
            try {
              const { withBranchStateLeaseWorkerAdmission } =
                await import("../state/branch-state-lease-worker-owner.js");
              const { runBranchStateWorkerOperation } =
                await import("../state/branch-state-worker-store.js");
              return await withBranchStateLeaseWorkerAdmission(
                lease,
                context.admission.databasePath,
                async (admission) => {
                  const assertCheckoutCurrent = () => {
                    context.admission.assertCurrent();
                    admission.assertCurrent();
                  };
                  const assertCurrent = () => {
                    assertCheckoutCurrent();
                    operationSignal.throwIfAborted();
                  };
                  return await runBranchStateWorkerOperation(
                    context,
                    async (scope) => {
                      const current = await scope.execute({
                        type: "projects.resolve",
                        input: { id },
                      });
                      assertCurrent();
                      return await run({
                        project: current,
                        assertCurrent,
                        assertCheckoutCurrent,
                        signal: operationSignal,
                      });
                    },
                    { assertCurrent, createAdmission: admission.createAdmission },
                  );
                },
              );
            } finally {
              // Resume cancellation while the native owner drains retained settlement and
              // selects unknown/lost/abort errors after this callback's cleanup has settled.
              signal?.addEventListener("abort", abortAcquisition, { once: true });
              if (signal?.aborted) {
                abortAcquisition();
              }
            }
          },
        );
      } finally {
        signal?.removeEventListener("abort", abortAcquisition);
      }
    },
  };
}

export function removeProjectCheckoutReference(
  project: ProjectRegistryRecord,
  lease: BranchStateLeaseContext,
  options: BranchStateDatabaseOptions = {},
): "missing" | "changed" | "remaining" | "final" {
  ensureProjectRegistrySchema(options);
  return runBranchStateWriteTransaction(
    ({ db: sqlite }) => {
      lease.assertOwnedInTransaction(sqlite);
      return removeProjectCheckoutReferenceInDatabase(sqlite, project);
    },
    options,
    { operationLabel: "projects.registry.checkout-reference.remove" },
  );
}

export async function resolveProjectCloneRefreshOwner(
  project: ProjectRegistryIdentity,
  lease: BranchStateLeaseContext,
  context: BranchStateWorkerContext,
): Promise<ProjectRegistryRecord | undefined> {
  const { runWithBranchStateLeaseWorker } =
    await import("../state/branch-state-lease-worker-operation.js");
  return await runWithBranchStateLeaseWorker(lease, context, (scope, identity) =>
    scope.execute({
      type: "projects.resolveRefreshOwner",
      input: { project, lease: identity },
    }),
  );
}

export async function resolveRecordedProjectRoot(
  projectPath: string,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<string | undefined> {
  const context = captureBranchStateWorkerContext(options);
  const repoRoot = await fs.realpath(projectPath).catch(() => undefined);
  if (!repoRoot) {
    return undefined;
  }
  const { executeBranchStateWorker } = await import("../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "projects.findRoot",
    input: { repoRoot },
  });
}

export async function removeProjectRegistry(
  project: ProjectRegistryRecord,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<boolean> {
  const selectedProject: ProjectRegistryIdentity = {
    id: project.id,
    repoRoot: project.repoRoot,
    source: project.source,
    originUrl: project.originUrl,
  };
  const env = cloneEnvWithPlatformSemantics(options.env ?? process.env);
  const context = captureBranchStateWorkerContext({ path: options.path, env });
  return await withProjectCheckoutLifecycle(
    selectedProject.repoRoot,
    { path: context.admission.databasePath, env },
    async (lease) => {
      const { runWithBranchStateLeaseWorker } =
        await import("../state/branch-state-lease-worker-operation.js");
      return await runWithBranchStateLeaseWorker(lease, context, (scope, identity) =>
        scope.execute({
          type: "projects.remove",
          input: { project: selectedProject, lease: identity },
        }),
      );
    },
  );
}
