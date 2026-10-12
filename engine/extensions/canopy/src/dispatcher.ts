import path from "node:path";
import type {
  CanopyCard,
  CanopyExecution,
  CanopyLaunchState,
  CanopyWorkspace,
} from "@branch/canopy-contract";
import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import {
  isFutureDateTimestampMs,
  resolveNonNegativeIntegerOption,
} from "branch/plugin-sdk/number-runtime";
import type { PluginRuntime } from "branch/plugin-sdk/plugin-runtime";
import { canonicalPathFromExistingAncestor } from "branch/plugin-sdk/security-runtime";
import {
  assertRestrictedCanopyTarget,
  cleanupCanopyCardWorktree,
  managedWorktreeName,
  resolveDispatchWorkspaceAccess,
  type ResolveAgentWorkspaceRuntime,
} from "./dispatcher-workspace.js";
import { canopySessionKeyForCard } from "./session-link.js";
import { cardBoardId } from "./store-card-helpers.js";
import { canopyCardConsumesOwnerSlot, canopyCardSlotOwner } from "./store-constants.js";
import { CanopyStore, type CanopyDispatchResult } from "./store.js";
import {
  assertCanonicalCanopyRootAccess,
  assertCanopyWorkspaceSourceAccess,
  CANOPY_REQUIRED_WORKER_TOOLS,
  type CanopyWorkspaceAccess,
} from "./workspace-access.js";

const DEFAULT_DISPATCH_MAX_STARTS = 3;

type CanopySubagentRuntime = Pick<PluginRuntime["subagent"], "run">;
type CanopyWorktreeRuntime = PluginRuntime["worktrees"];

type CanopyDispatchStartOptions = {
  cardId?: string;
  maxStarts?: number;
  model?: string;
  provider?: string;
  ownerId?: string;
  boardId?: string;
  now?: number;
  materializeWorktree?: boolean;
  resolveAgentWorkspace?: (agentId?: string) => string;
  resolveAgentWorkspaceRuntime?: ResolveAgentWorkspaceRuntime;
  workspaceAccess?: CanopyWorkspaceAccess;
  assertOwnerCurrent?: () => void;
};

type CanopyStartedRun = {
  cardId: string;
  title: string;
  sessionKey: string;
  runId: string;
  card?: CanopyCard;
};

type CanopyStartFailure = {
  cardId: string;
  title: string;
  error: string;
};

type CanopyDispatchAndStartResult = CanopyDispatchResult & {
  started: CanopyStartedRun[];
  startFailures: CanopyStartFailure[];
};

type CanopyPreparedLaunch = Extract<CanopyLaunchState, { phase: "prepared" }>;

type CanopyDispatchStartParams = {
  store: CanopyStore;
  subagent: CanopySubagentRuntime;
  worktrees?: CanopyWorktreeRuntime;
  options?: CanopyDispatchStartOptions;
};

const pendingCanopyDispatches = new WeakMap<CanopyStore, Promise<void>>();

function cardHasActiveClaim(card: CanopyCard, now: number): boolean {
  const claim = card.metadata?.claim;
  return Boolean(claim && isFutureDateTimestampMs(claim.expiresAt, { nowMs: now }));
}

async function materializeWorkspace(params: {
  card: CanopyCard;
  worktrees?: CanopyWorktreeRuntime;
  materializeWorktree: boolean;
  workspaceAccess: CanopyWorkspaceAccess;
  assertOwnerCurrent?: () => void;
}): Promise<{ workspace?: CanopyWorkspace; cwd?: string }> {
  const workspace = params.card.metadata?.automation?.workspace;
  if (!workspace || workspace.kind === "scratch") {
    return {};
  }
  const sourcePath = workspace.sourcePath ?? workspace.path;
  const sourceBranch = workspace.sourcePath ? workspace.sourceBranch : workspace.branch;
  if (!sourcePath || !path.isAbsolute(sourcePath)) {
    throw new Error("worktree workspace path must be an absolute git checkout path");
  }
  // Persisted cards can outlive the caller that created them. Keep the exact
  // canonical path that passes this dispatcher's current boundary check.
  const canonicalSourcePath = await assertCanopyWorkspaceSourceAccess(
    workspace,
    params.workspaceAccess,
  );
  if (!canonicalSourcePath) {
    throw new Error("worktree workspace path is required");
  }
  if (workspace.kind === "dir" || !params.workspaceAccess.unrestricted) {
    await assertCanonicalCanopyRootAccess(canonicalSourcePath, params.workspaceAccess);
    return workspace.kind === "worktree"
      ? { cwd: canonicalSourcePath, workspace: { kind: "dir", path: canonicalSourcePath } }
      : { cwd: canonicalSourcePath };
  }
  if (!params.materializeWorktree) {
    throw new Error("managed worktree materialization was not explicitly authorized");
  }
  if (!params.worktrees) {
    throw new Error("managed worktree runtime is unavailable");
  }
  params.assertOwnerCurrent?.();
  const worktree = await params.worktrees.create({
    repoRoot: canonicalSourcePath,
    name: managedWorktreeName(params.card.id),
    ...(sourceBranch ? { baseRef: sourceBranch } : {}),
    ownerKind: "canopy",
    ownerId: params.card.id,
    ...(params.assertOwnerCurrent ? { commitGuard: params.assertOwnerCurrent } : {}),
  });
  let cwd: string;
  try {
    cwd = await canonicalPathFromExistingAncestor(worktree.path);
  } catch (error) {
    const removed = await params.worktrees
      .removeIfLossless({
        path: worktree.path,
        ownerKind: "canopy",
        ownerId: params.card.id,
      })
      .catch(() => false);
    if (!removed) {
      throw new Error(`${formatErrorMessage(error)}; managed worktree cleanup failed`, {
        cause: error,
      });
    }
    throw error;
  }
  return {
    cwd,
    workspace: {
      kind: "worktree",
      path: worktree.path,
      branch: worktree.branch,
      sourcePath,
      ...(sourceBranch ? { sourceBranch } : {}),
    },
  };
}

function sortReadyCards(a: CanopyCard, b: CanopyCard): number {
  const priorityRank: Record<CanopyCard["priority"], number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return (
    priorityRank[a.priority] - priorityRank[b.priority] ||
    a.position - b.position ||
    a.createdAt - b.createdAt
  );
}

function selectStartableCards(
  cards: CanopyCard[],
  limit: number,
  candidates: CanopyCard[],
  ownerOverride: string | undefined,
  now: number,
  mode: "scheduled" | "exact",
): { cards: CanopyCard[]; rejection?: CanopyStartFailure } {
  if (limit <= 0) {
    return { cards: [] };
  }
  const runningOwners = new Set<string>();
  for (const card of cards) {
    if (!canopyCardConsumesOwnerSlot(card, now)) {
      continue;
    }
    runningOwners.add(canopyCardSlotOwner(card));
  }
  const selected: CanopyCard[] = [];
  const fallback: CanopyCard[] = [];
  const selectedOwners = new Set<string>();
  const ordered = mode === "scheduled" ? candidates.toSorted(sortReadyCards) : candidates;
  for (const card of ordered) {
    const owner = ownerOverride || canopyCardSlotOwner(card, now);
    const rejection = card.metadata?.archivedAt
      ? "Card is archived; restore it before starting."
      : cardHasActiveClaim(card, now)
        ? `Card is already claimed by ${card.metadata?.claim?.ownerId ?? "another worker"}.`
        : mode === "scheduled" && card.status !== "ready"
          ? ""
          : mode === "exact" &&
              card.status !== "backlog" &&
              card.status !== "todo" &&
              card.status !== "ready"
            ? `Card cannot start from ${card.status}; move it to backlog, todo, or ready first.`
            : runningOwners.has(owner)
              ? `Owner ${owner} already has active Canopy work; complete or stop it before starting another card.`
              : undefined;
    if (rejection !== undefined) {
      if (mode === "exact") {
        return {
          cards: [],
          rejection: { cardId: card.id, title: card.title, error: rejection },
        };
      }
      continue;
    }
    if (selectedOwners.has(owner)) {
      fallback.push(card);
      continue;
    }
    selectedOwners.add(owner);
    selected.push(card);
  }
  // Try each owner before a failed owner's extra cards consume the outage budget.
  return { cards: [...selected, ...fallback] };
}

export async function dispatchAndStartCanopyCards(
  params: CanopyDispatchStartParams,
): Promise<CanopyDispatchAndStartResult> {
  const previous = pendingCanopyDispatches.get(params.store);
  // Board filters must share their store's owner-capacity snapshot; otherwise
  // simultaneous passes can claim different cards for the same active worker.
  const dispatch = previous
    ? previous.then(() => runCanopyDispatch(params))
    : runCanopyDispatch(params);
  const settled = dispatch.then(
    () => undefined,
    () => undefined,
  );
  pendingCanopyDispatches.set(params.store, settled);
  try {
    return await dispatch;
  } finally {
    if (pendingCanopyDispatches.get(params.store) === settled) {
      pendingCanopyDispatches.delete(params.store);
    }
  }
}

async function runCanopyDispatch(
  params: CanopyDispatchStartParams,
): Promise<CanopyDispatchAndStartResult> {
  const now = params.options?.now ?? Date.now();
  const boardId = params.options?.boardId;
  const directCardId = params.options?.cardId;
  const assertOwnerCurrent = params.options?.assertOwnerCurrent;
  const directCard = directCardId
    ? await params.store.prepareStart(directCardId, now, assertOwnerCurrent)
    : undefined;
  const dispatch = directCard
    ? { promoted: [], reclaimed: [], blocked: [], orchestrated: [], count: 0 }
    : await params.store.dispatch({ now, boardId, assertOwnerCurrent });
  const maxStarts = resolveNonNegativeIntegerOption(
    params.options?.maxStarts,
    DEFAULT_DISPATCH_MAX_STARTS,
  );
  const started: CanopyStartedRun[] = [];
  const startFailures: CanopyStartFailure[] = [];
  const cards = await params.store.list();
  const candidates = directCard ? [directCard] : await params.store.list({ boardId });
  const ownerOverride = params.options?.ownerId?.trim() || undefined;
  const startedOwners = new Set<string>();
  // Allow one fallback per worker slot without draining the queue during an outage.
  const maxAttempts = maxStarts * 2;
  let acceptedStarts = 0;
  let attemptedStarts = 0;

  const selection = selectStartableCards(
    cards,
    maxStarts,
    candidates,
    ownerOverride,
    now,
    directCardId ? "exact" : "scheduled",
  );
  if (selection.rejection) {
    startFailures.push(selection.rejection);
  }
  for (const card of selection.cards) {
    const ownerId = ownerOverride || canopyCardSlotOwner(card, now);
    if (acceptedStarts >= maxStarts || attemptedStarts >= maxAttempts) {
      break;
    }
    if (startedOwners.has(ownerId)) {
      continue;
    }
    const sessionKey = canopySessionKeyForCard(card);
    let claimValue = "";
    let implicitWorkspaceCwd: string | undefined;
    let runStarted = false;
    let workspaceMutation: { before: CanopyCard; after: CanopyCard } | undefined;
    let preparedLaunch: CanopyPreparedLaunch | undefined;
    const requestedWorkspace = card.metadata?.automation?.workspace;
    let workspaceAccess: CanopyWorkspaceAccess;
    let targetWorkspace: string | undefined;
    let persistWorkspaceAccess: boolean;
    const assertRestrictedTarget = (root: string) =>
      assertRestrictedCanopyTarget({
        root,
        agentId: card.agentId,
        sessionKey,
        modelProvider: params.options?.provider,
        modelId: params.options?.model,
        resolveAgentWorkspaceRuntime: params.options?.resolveAgentWorkspaceRuntime,
        worktrees: params.worktrees,
      });
    // Preflight failures leave the card unclaimed; keep them outside the
    // claim and launch compensation boundary below.
    try {
      ({ workspaceAccess, targetWorkspace, persistWorkspaceAccess } =
        await resolveDispatchWorkspaceAccess({
          card,
          currentAccess: params.options?.workspaceAccess,
          resolveAgentWorkspace: params.options?.resolveAgentWorkspace,
        }));
      if (!requestedWorkspace || requestedWorkspace.kind === "scratch") {
        if (!workspaceAccess.unrestricted) {
          if (!targetWorkspace) {
            startFailures.push({
              cardId: card.id,
              title: card.title,
              error: "target agent workspace is unavailable for restricted dispatch",
            });
            continue;
          }
          implicitWorkspaceCwd = targetWorkspace;
          await assertCanonicalCanopyRootAccess(implicitWorkspaceCwd, workspaceAccess);
          await assertRestrictedTarget(implicitWorkspaceCwd);
        }
      } else {
        const canonicalSourcePath = await assertCanopyWorkspaceSourceAccess(
          requestedWorkspace,
          workspaceAccess,
        );
        if (
          canonicalSourcePath &&
          requestedWorkspace.kind === "dir" &&
          workspaceAccess.unrestricted
        ) {
          await assertCanonicalCanopyRootAccess(canonicalSourcePath, workspaceAccess);
        }
        if (canonicalSourcePath && !workspaceAccess.unrestricted) {
          await assertCanonicalCanopyRootAccess(canonicalSourcePath, workspaceAccess);
          await assertRestrictedTarget(canonicalSourcePath);
        }
      }
    } catch (error) {
      startFailures.push({
        cardId: card.id,
        title: card.title,
        error: formatErrorMessage(error),
      });
      continue;
    }
    try {
      const claimed = await params.store.claim(
        card.id,
        { ownerId, ttlSeconds: card.metadata?.automation?.maxRuntimeSeconds },
        {
          expectedAuthority: {
            boardId: cardBoardId(card),
            status: card.status,
            agentId: card.agentId,
            workspace: card.metadata?.automation?.workspace,
            workspaceAccess: card.metadata?.automation?.workspaceAccess,
          },
          adoptWorkspaceAccess: persistWorkspaceAccess ? workspaceAccess : undefined,
          assertOwnerCurrent,
        },
      );
      claimValue = claimed.token;
      // Racing card changes never reached a worker and must not consume the
      // provider-outage budget or starve a later healthy candidate.
      attemptedStarts += 1;
      const context = await params.store.buildWorkerContext(card.id);
      const materialized = await materializeWorkspace({
        card: claimed.card,
        worktrees: params.worktrees,
        materializeWorktree: params.options?.materializeWorktree === true,
        workspaceAccess,
        assertOwnerCurrent,
      });
      const runCwd = materialized.cwd ?? implicitWorkspaceCwd;
      if (runCwd && !workspaceAccess.unrestricted) {
        await assertRestrictedTarget(runCwd);
      }
      const materializedWorkspace = materialized.workspace;
      if (materializedWorkspace) {
        const workspaceBase = await params.store.get(card.id);
        if (!workspaceBase) {
          throw new Error(`card not found: ${card.id}`);
        }
        const materializedCard = await params.store.update(
          card.id,
          { workspace: materializedWorkspace, workspaceAccess },
          { expectedUpdatedAt: workspaceBase.updatedAt },
        );
        workspaceMutation = { before: workspaceBase, after: materializedCard };
      }
      const prepared = await params.store.prepareExecutionLaunch(card.id, {
        requestedSessionKey: sessionKey,
        now,
        scope: { ownerId, token: claimValue },
        assertOwnerCurrent,
      });
      const launched = prepared.card;
      preparedLaunch = prepared.launch;
      const runId = prepared.launch.provisionalRunId;
      assertOwnerCurrent?.();
      const run = await params.subagent.run({
        sessionKey,
        ...(assertOwnerCurrent ? { assertCurrent: assertOwnerCurrent } : {}),
        message: [
          `Work on this Branch Agent Canopy card: ${claimed.card.title}`,
          "",
          "## Worker protocol",
          `Card id: ${claimed.card.id}`,
          `Claim ownerId: ${ownerId}`,
          `Claim token: ${claimValue}`,
          "",
          "Heartbeat with canopy_heartbeat using the card id and token while working.",
          "When done, call canopy_complete with the card id, token, summary, and proof.",
          "If you recorded proof separately, pass its returned proofId to canopy_complete.",
          "If blocked, call canopy_block with the card id, token, and reason.",
          "",
          context,
        ].join("\n"),
        toolsAlsoAllow: [...CANOPY_REQUIRED_WORKER_TOOLS],
        ...(params.options?.provider ? { provider: params.options.provider } : {}),
        ...(params.options?.model ? { model: params.options.model } : {}),
        lane: `canopy:${cardBoardId(card)}:${card.id}`,
        idempotencyKey: runId,
        lightContext: true,
        deliver: false,
        ...(runCwd ? { cwd: runCwd } : {}),
      });
      runStarted = true;
      const acceptedSessionKey = run.sessionKey?.trim() || sessionKey;
      const acceptedExecution: CanopyExecution = {
        id: launched.execution?.id ?? `${launched.id}:agent-session`,
        kind: "agent-session",
        mode: "autonomous",
        status: "running",
        ...(run.runtime
          ? {
              engine: run.runtime.harness,
              model: `${run.runtime.provider}/${run.runtime.model}`,
            }
          : {}),
        sessionKey: acceptedSessionKey,
        runId: run.runId,
        startedAt: now,
        updatedAt: now,
      };
      const acceptedCard = {
        ...launched,
        sessionKey: acceptedSessionKey,
        runId: run.runId,
        execution: acceptedExecution,
      };
      const updated =
        (await params.store
          .acceptExecutionLaunch(card.id, {
            expectedLaunch: prepared.launch,
            acceptedAt: Math.max(Date.now(), prepared.launch.preparedAt),
            expectedSessionKey: sessionKey,
            expectedRunId: runId,
            sessionKey: acceptedSessionKey,
            runId: run.runId,
            execution: acceptedExecution,
          })
          .catch(() => undefined)) ?? acceptedCard;
      acceptedStarts += 1;
      startedOwners.add(ownerId);
      started.push({
        cardId: updated.id,
        title: updated.title,
        sessionKey: acceptedSessionKey,
        runId: run.runId,
        ...(directCardId ? { card: updated } : {}),
      });
      // A worker already accepted this run. Logging must never revoke its
      // claim, block live execution, or reopen the owner's capacity slot.
      await params.store
        .addWorkerLog(
          updated.id,
          {
            level: "info",
            message: `Dispatcher started subagent run ${run.runId}.`,
            sessionKey: acceptedSessionKey,
            runId: run.runId,
          },
          { ownerId, token: claimValue },
        )
        .catch(() => undefined);
    } catch (error) {
      const message = formatErrorMessage(error);
      startFailures.push({ cardId: card.id, title: card.title, error: message });
      if (!claimValue || runStarted) {
        continue;
      }
      try {
        const reason = `Dispatcher could not start worker: ${message}`;
        if (preparedLaunch) {
          await params.store.failPreparedLaunch(card.id, {
            expectedLaunch: preparedLaunch,
            reason,
            failedAt: Date.now(),
          });
        } else {
          await params.store.block(
            card.id,
            { ownerId, token: claimValue, reason },
            { ownerId, token: claimValue },
          );
        }
      } catch {
        // Leave the original start failure visible; dispatch will diagnose stale claims later.
      }
      if (params.worktrees) {
        const failedCard = await params.store.get(card.id).catch(() => undefined);
        if (failedCard) {
          await cleanupCanopyCardWorktree({
            store: params.store,
            worktrees: params.worktrees,
            card: failedCard,
            ...(workspaceMutation ? { workspaceMutation } : {}),
          }).catch(() => undefined);
        }
      }
    }
  }

  return {
    ...dispatch,
    started,
    startFailures,
    count: dispatch.count + started.length + startFailures.length,
  };
}
