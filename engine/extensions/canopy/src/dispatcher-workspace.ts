import type { CanopyCard } from "@branch/canopy-contract";
// Canopy dispatch workspace helpers keep authority resolution outside the orchestration loop.
import type { PluginRuntime } from "branch/plugin-sdk/plugin-runtime";
import {
  canonicalPathFromExistingAncestor,
  pathExists,
} from "branch/plugin-sdk/security-runtime";
import type { CanopyStore } from "./store.js";
import {
  assertCanonicalCanopyRootAccess,
  canonicalizeCanopyWorkspaceAccess,
  intersectCanopyWorkspaceAccess,
  type CanopyTargetWorkspaceRuntime,
  type CanopyWorkspaceAccess,
} from "./workspace-access.js";

export type ResolveAgentWorkspaceRuntime = (
  agentId: string | undefined,
  sessionKey: string,
  workspaceDir: string,
  modelProvider?: string,
  modelId?: string,
) => CanopyTargetWorkspaceRuntime | Promise<CanopyTargetWorkspaceRuntime>;

export function managedWorktreeName(cardId: string): string {
  const suffix = cardId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
  return `wb-${suffix}`.slice(0, 64).replace(/-$/, "");
}

export type CanopyWorktreeCleanupRuntime = Pick<PluginRuntime["worktrees"], "removeIfLossless">;

type CanopyWorkspaceMutation = {
  before: CanopyCard;
  after: CanopyCard;
};

function hasTerminalCanopyExecution(card: CanopyCard): boolean {
  const status = card.execution?.status ?? card.status;
  return status === "review" || status === "blocked" || status === "done";
}

export function isCanopyWorktreeCleanupCandidate(card: CanopyCard): boolean {
  const workspace = card.metadata?.automation?.workspace;
  return Boolean(
    workspace?.kind === "worktree" &&
    workspace.path &&
    workspace.sourcePath &&
    hasTerminalCanopyExecution(card),
  );
}

export async function cleanupCanopyCardWorktree(params: {
  store: CanopyStore;
  worktrees: CanopyWorktreeCleanupRuntime;
  card: CanopyCard;
  workspaceMutation?: CanopyWorkspaceMutation;
}): Promise<void> {
  const current = await params.store.get(params.card.id);
  const workspace = (params.workspaceMutation?.after ?? current)?.metadata?.automation?.workspace;
  if (
    !current ||
    !hasTerminalCanopyExecution(current) ||
    workspace?.kind !== "worktree" ||
    !workspace?.path ||
    !workspace.sourcePath
  ) {
    return;
  }
  const removed = await params.worktrees.removeIfLossless({
    path: workspace.path,
    ownerKind: "canopy",
    ownerId: params.card.id,
  });
  if (!removed && (await pathExists(workspace.path))) {
    return;
  }
  if (params.workspaceMutation) {
    await params.store.compensateWorkspaceMutation(
      params.workspaceMutation.before,
      params.workspaceMutation.after,
    );
    return;
  }
  await params.store.update(
    current.id,
    {
      workspace: {
        kind: "worktree",
        path: workspace.sourcePath,
        ...(workspace.sourceBranch ? { branch: workspace.sourceBranch } : {}),
      },
    },
    { expectedUpdatedAt: current.updatedAt },
  );
}

export async function resolveDispatchWorkspaceAccess(params: {
  card: CanopyCard;
  currentAccess?: CanopyWorkspaceAccess;
  resolveAgentWorkspace?: (agentId?: string) => string;
}): Promise<{
  workspaceAccess: CanopyWorkspaceAccess;
  targetWorkspace?: string;
  persistWorkspaceAccess: boolean;
}> {
  const currentAccess = await canonicalizeCanopyWorkspaceAccess(
    params.currentAccess ?? { unrestricted: true },
  );
  const persistedAccess = params.card.metadata?.automation?.workspaceAccess;
  const workspace = params.card.metadata?.automation?.workspace;
  let targetWorkspace: string | undefined;
  if (!persistedAccess?.unrestricted || !currentAccess.unrestricted) {
    const resolved = params.resolveAgentWorkspace?.(params.card.agentId);
    targetWorkspace = resolved ? await canonicalPathFromExistingAncestor(resolved) : undefined;
  }
  const cardAccess = persistedAccess
    ? await canonicalizeCanopyWorkspaceAccess(persistedAccess)
    : currentAccess.unrestricted
      ? !workspace || workspace.kind === "scratch"
        ? currentAccess
        : (() => {
            throw new Error(
              "card workspace authority is unknown; re-save its workspace with current permissions before dispatch.",
            );
          })()
      : currentAccess;
  const workspaceAccess = intersectCanopyWorkspaceAccess(cardAccess, currentAccess);
  if (!workspaceAccess.unrestricted && !workspaceAccess.writable) {
    throw new Error(
      "card workspace authority is read-only; manual movement is allowed but worker dispatch requires write access.",
    );
  }
  return {
    workspaceAccess,
    ...(targetWorkspace ? { targetWorkspace } : {}),
    persistWorkspaceAccess: !persistedAccess,
  };
}

export async function assertRestrictedCanopyTarget(params: {
  root: string;
  agentId?: string;
  sessionKey: string;
  modelProvider?: string;
  modelId?: string;
  resolveAgentWorkspaceRuntime?: ResolveAgentWorkspaceRuntime;
  worktrees?: Pick<
    PluginRuntime["worktrees"],
    "resolveCheckoutRoot" | "hasSelfContainedCheckoutMetadata"
  >;
}): Promise<void> {
  const resolved: CanopyTargetWorkspaceRuntime = params.resolveAgentWorkspaceRuntime
    ? await params.resolveAgentWorkspaceRuntime(
        params.agentId,
        params.sessionKey,
        params.root,
        params.modelProvider,
        params.modelId,
      )
    : {
        sandboxed: false,
        workspaceAccess: { unrestricted: true } as const,
      };
  const targetRuntime = {
    ...resolved,
    workspaceAccess: await canonicalizeCanopyWorkspaceAccess(resolved.workspaceAccess),
  };
  if (!targetRuntime.sandboxed) {
    throw new Error("target agent is not sandboxed for this restricted Canopy card.");
  }
  if (targetRuntime.confinementError) {
    throw new Error(targetRuntime.confinementError);
  }
  if (targetRuntime.workspaceAccess.unrestricted || !targetRuntime.workspaceAccess.writable) {
    throw new Error("target agent does not have writable workspace-only access.");
  }
  await assertCanonicalCanopyRootAccess(params.root, targetRuntime.workspaceAccess);
  if (!params.worktrees) {
    throw new Error("workspace checkout inspection is unavailable for restricted dispatch.");
  }
  const checkoutRoot = await params.worktrees.resolveCheckoutRoot({ path: params.root });
  if (!checkoutRoot) {
    return;
  }
  if ((await canonicalPathFromExistingAncestor(checkoutRoot)) !== params.root) {
    throw new Error("workspace root is nested inside a broader Git checkout.");
  }
  if (
    !params.worktrees.hasSelfContainedCheckoutMetadata ||
    !(await params.worktrees.hasSelfContainedCheckoutMetadata({ path: params.root }))
  ) {
    throw new Error("restricted workspace Git metadata must be contained inside its root.");
  }
}
