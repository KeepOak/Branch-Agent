import type {
  CanopyCard,
  CanopyExecutionStatus,
  CanopyStatus,
} from "@branch/canopy-contract";
import { resolveGlobalSingleton } from "branch/plugin-sdk/global-singleton";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { BranchPluginApi, BranchPluginService } from "../api.js";
import {
  cleanupCanopyCardWorktree,
  isCanopyWorktreeCleanupCandidate,
  type CanopyWorktreeCleanupRuntime,
} from "./dispatcher-workspace.js";
import {
  canopyCardMatchesLifecycleLink,
  canopyCardSessionLookupKey,
} from "./session-link.js";
import { cardRunId, cardSessionKey } from "./store-card-helpers.js";
import { DEFAULT_CANOPY_DISPATCH_OWNER } from "./store-constants.js";
import type { CanopyStore } from "./store.js";

const CANOPY_LIFECYCLE_SWEEP_MS = 60_000;
const CANOPY_STALE_SESSION_MS = 30 * 60 * 1000;
const CANOPY_SESSION_SWEEP_LIMIT = 10_000;
const CANOPY_WORKTREE_CLEANUP_SWEEP_LIMIT = 32;
// Keep readiness across plugin-only reloads, while the singleton lifecycle
// clears it before an in-process Gateway restart starts replacement services.
const canopyLifecycleGatewayState = resolveGlobalSingleton<{
  ready: boolean;
  abortSignal?: AbortSignal;
}>(
  Symbol.for("branch.canopy.lifecycleGatewayState"),
  () => ({ ready: false }),
  (state) => {
    state.ready = false;
    state.abortSignal = undefined;
  },
);

type CanopyLifecycleState = "running" | "succeeded" | "failed" | "idle" | "stale";

type CanopyLifecycleObservation = {
  state: CanopyLifecycleState;
  sourceUpdatedAt?: number;
  stale?: {
    detectedAt: number;
    lastSessionUpdatedAt: number;
    reason: string;
  };
};

type CanopyLifecycleSession = {
  key: string;
  updatedAt?: number;
  status?: "running" | "done" | "failed" | "killed" | "timeout";
  hasActiveRun?: boolean;
  abortedLastRun?: boolean;
};

type CanopyLifecycleSessionSnapshot = {
  sessions: CanopyLifecycleSession[];
  complete: boolean;
};

function sessionProvesPreparedAcceptance(session: CanopyLifecycleSession): boolean {
  return (
    session.hasActiveRun === true ||
    session.status === "done" ||
    session.status === "failed" ||
    session.status === "killed" ||
    session.status === "timeout"
  );
}

type CanopyLifecycleSessionReadOptions = {
  includeUnknown: boolean;
};

type CanopyLifecycleMatchHandler = (input: {
  cards: readonly CanopyCard[];
  sessionKey?: string;
}) => Promise<void>;

type CanopyLifecycleService = BranchPluginService & {
  stop: () => void;
  onGatewayStart: (abortSignal?: AbortSignal) => void;
  onGatewayStop: () => void;
};

function needsCanopyLifecycleReconciliation(card: CanopyCard): boolean {
  if (card.metadata?.archivedAt) {
    return false;
  }
  // A running claim can own an accepted session even when persisting its link failed.
  // Keep those cards, and stale cleanup, in the missed-event recovery sweep.
  return Boolean(
    card.sessionKey ||
    card.runId ||
    card.execution ||
    card.status === "running" ||
    card.metadata?.claim ||
    card.metadata?.stale,
  );
}

const LIFECYCLE_TARGETS = {
  running: { card: "running", execution: "running" },
  succeeded: { card: "review", execution: "review" },
  failed: { card: "blocked", execution: "blocked" },
  idle: { execution: "idle" },
  stale: { card: "running", execution: "running" },
} as const satisfies Record<
  CanopyLifecycleState,
  { card?: CanopyStatus; execution?: CanopyExecutionStatus }
>;

async function syncCanopyCardLifecycle(params: {
  store: CanopyStore;
  cardId: string;
  observation: CanopyLifecycleObservation;
  now: number;
  association?: {
    expectedSessionKey?: string;
    expectedRunId?: string;
    sessionKey: string;
    runId?: string;
    acceptedAt?: number;
  };
}): Promise<boolean> {
  const target = LIFECYCLE_TARGETS[params.observation.state];
  return await params.store.syncLifecycle(params.cardId, {
    targetStatus: "card" in target ? target.card : undefined,
    executionStatus: "execution" in target ? target.execution : undefined,
    sourceUpdatedAt: params.observation.sourceUpdatedAt,
    stale: params.observation.stale,
    now: params.now,
    ...(params.association ? { association: params.association } : {}),
  });
}

async function syncCanopyLifecycleEvent(params: {
  store: CanopyStore;
  source: { sessionKey?: string; runId?: string };
  observation: CanopyLifecycleObservation;
  now: number;
  onMatched?: CanopyLifecycleMatchHandler;
}): Promise<{ cards: readonly CanopyCard[]; count: number }> {
  const cards = (await params.store.list()).filter(
    (card) => !card.metadata?.archivedAt && canopyCardMatchesLifecycleLink(card, params.source),
  );
  const updates = Promise.all(
    cards.map(
      async (card) =>
        await syncCanopyCardLifecycle({
          ...params,
          cardId: card.id,
          ...(params.source.sessionKey
            ? {
                association: {
                  ...(cardSessionKey(card) ? { expectedSessionKey: cardSessionKey(card) } : {}),
                  ...(cardRunId(card) ? { expectedRunId: cardRunId(card) } : {}),
                  sessionKey: params.source.sessionKey,
                  ...(params.source.runId ? { runId: params.source.runId } : {}),
                  acceptedAt: params.observation.sourceUpdatedAt ?? params.now,
                },
              }
            : {}),
        }),
    ),
  );
  await Promise.all([
    updates,
    params.onMatched?.({
      cards,
      ...(params.source.sessionKey ? { sessionKey: params.source.sessionKey } : {}),
    }),
  ]);
  return { cards, count: (await updates).filter(Boolean).length };
}

export async function syncCanopySubagentEnded(params: {
  store: CanopyStore;
  worktrees?: CanopyWorktreeCleanupRuntime;
  event: {
    targetSessionKey: string;
    runId?: string;
    endedAt?: number;
    outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
  };
  now?: number;
  onMatched?: CanopyLifecycleMatchHandler;
}): Promise<number> {
  const now = params.now ?? Date.now();
  const synced = await syncCanopyLifecycleEvent({
    store: params.store,
    source: { sessionKey: params.event.targetSessionKey, runId: params.event.runId },
    observation: {
      state: params.event.outcome === "ok" ? "succeeded" : "failed",
      sourceUpdatedAt: params.event.endedAt ?? now,
    },
    now,
    ...(params.onMatched ? { onMatched: params.onMatched } : {}),
  });
  if (params.worktrees) {
    for (const matched of synced.cards) {
      const card = await params.store.get(matched.id);
      if (card) {
        await cleanupCanopyCardWorktree({
          store: params.store,
          worktrees: params.worktrees,
          card,
        });
      }
    }
  }
  return synced.count;
}

export async function syncCanopyAgentEnded(params: {
  store: CanopyStore;
  event: { runId?: string; success: boolean };
  context: { runId?: string; sessionKey?: string };
  now?: number;
  onMatched?: CanopyLifecycleMatchHandler;
}): Promise<number> {
  const now = params.now ?? Date.now();
  return (
    await syncCanopyLifecycleEvent({
      store: params.store,
      source: {
        sessionKey: params.context.sessionKey,
        runId: params.event.runId ?? params.context.runId,
      },
      observation: {
        state: params.event.success ? "succeeded" : "failed",
        sourceUpdatedAt: now,
      },
      now,
      ...(params.onMatched ? { onMatched: params.onMatched } : {}),
    })
  ).count;
}

function lifecycleFromSession(
  session: CanopyLifecycleSession,
  now: number,
): CanopyLifecycleObservation {
  const sourceUpdatedAt = session.updatedAt;
  if (
    session.status === "running" &&
    session.hasActiveRun === false &&
    sourceUpdatedAt !== undefined &&
    now - sourceUpdatedAt >= CANOPY_STALE_SESSION_MS
  ) {
    return {
      state: "stale",
      sourceUpdatedAt,
      stale: {
        detectedAt: now,
        lastSessionUpdatedAt: sourceUpdatedAt,
        reason: "Linked session has not reported recent activity.",
      },
    };
  }
  if (session.hasActiveRun === true || session.status === "running") {
    return { state: "running", sourceUpdatedAt };
  }
  if (
    session.abortedLastRun ||
    session.status === "failed" ||
    session.status === "killed" ||
    session.status === "timeout"
  ) {
    return { state: "failed", sourceUpdatedAt };
  }
  if (session.status === "done") {
    return { state: "succeeded", sourceUpdatedAt };
  }
  return { state: "idle", sourceUpdatedAt };
}

async function syncCanopyLifecycleSessions(params: {
  store: CanopyStore;
  cards?: readonly CanopyCard[];
  sessions: readonly CanopyLifecycleSession[];
  complete?: boolean;
  now?: number;
}): Promise<number> {
  const now = params.now ?? Date.now();
  const sessionsByKey = new Map<string, CanopyLifecycleSession>();
  const sessionsByCanopySuffix = new Map<string, CanopyLifecycleSession>();
  const ambiguousCanopySuffixes = new Set<string>();
  for (const session of params.sessions) {
    sessionsByKey.set(session.key, session);
    const suffixIndex = session.key.lastIndexOf(":subagent:canopy-");
    if (suffixIndex >= 0) {
      const suffix = session.key.slice(suffixIndex + 1);
      const existing = sessionsByCanopySuffix.get(suffix);
      if (existing && existing.key !== session.key) {
        sessionsByCanopySuffix.delete(suffix);
        ambiguousCanopySuffixes.add(suffix);
      } else if (!ambiguousCanopySuffixes.has(suffix)) {
        sessionsByCanopySuffix.set(suffix, session);
      }
    }
  }
  let count = 0;
  for (const card of params.cards ?? (await params.store.list())) {
    if (card.metadata?.archivedAt) {
      continue;
    }
    const lookupKey = canopyCardSessionLookupKey(card);
    const suffixIndex = lookupKey.lastIndexOf("subagent:canopy-");
    const linkedSessionKey = cardSessionKey(card);
    const canUseAgentlessFallback =
      linkedSessionKey?.startsWith("subagent:canopy-") === true ||
      (!linkedSessionKey &&
        (!card.agentId ||
          (card.agentId === DEFAULT_CANOPY_DISPATCH_OWNER &&
            card.metadata?.claim?.ownerId === DEFAULT_CANOPY_DISPATCH_OWNER)));
    // Persisted links and explicit agent targets stay authoritative. The unique
    // suffix fallback recovers a run accepted before its link could be persisted.
    const session =
      sessionsByKey.get(lookupKey) ??
      (canUseAgentlessFallback && suffixIndex >= 0
        ? sessionsByCanopySuffix.get(lookupKey.slice(suffixIndex))
        : undefined);
    const launch = card.metadata?.automation?.launch;
    const preparedAcceptanceAt =
      launch?.phase === "prepared" && session && sessionProvesPreparedAcceptance(session)
        ? session.hasActiveRun === true
          ? Math.max(now, launch.preparedAt)
          : session.updatedAt
        : undefined;
    if (
      launch?.phase === "prepared" &&
      (preparedAcceptanceAt === undefined || preparedAcceptanceAt < launch.preparedAt)
    ) {
      if (
        params.complete &&
        (await params.store.failPreparedLaunch(card.id, {
          expectedLaunch: launch,
          reason: "Gateway did not accept the prepared Canopy session before restart.",
          failedAt: now,
        }))
      ) {
        count += 1;
      }
      continue;
    }
    if (!session) {
      continue;
    }
    const observation = lifecycleFromSession(session, now);
    if (
      await syncCanopyCardLifecycle({
        store: params.store,
        cardId: card.id,
        observation,
        now,
        association: {
          ...(cardSessionKey(card) ? { expectedSessionKey: cardSessionKey(card) } : {}),
          ...(cardRunId(card) ? { expectedRunId: cardRunId(card) } : {}),
          sessionKey: session.key,
          ...(preparedAcceptanceAt === undefined ? {} : { acceptedAt: preparedAcceptanceAt }),
        },
      })
    ) {
      count += 1;
    }
  }
  return count;
}

function normalizeSession(value: unknown): CanopyLifecycleSession | undefined {
  if (!isRecord(value) || typeof value.key !== "string" || !value.key) {
    return undefined;
  }
  const status =
    value.status === "running" ||
    value.status === "done" ||
    value.status === "failed" ||
    value.status === "killed" ||
    value.status === "timeout"
      ? value.status
      : undefined;
  return {
    key: value.key,
    ...(typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(status ? { status } : {}),
    ...(typeof value.hasActiveRun === "boolean" ? { hasActiveRun: value.hasActiveRun } : {}),
    ...(value.abortedLastRun === true ? { abortedLastRun: true } : {}),
  };
}

export async function readCanopyLifecycleSessions(
  gateway: Pick<BranchPluginApi["runtime"]["gateway"], "isAvailable" | "request">,
  options: CanopyLifecycleSessionReadOptions = { includeUnknown: false },
): Promise<CanopyLifecycleSessionSnapshot> {
  if (!(await gateway.isAvailable())) {
    return { sessions: [], complete: false };
  }
  let includeUnknown = false;
  if (options.includeUnknown) {
    const agentsPayload = await gateway.request("agents.list", {}, { scopes: ["operator.read"] });
    if (!isRecord(agentsPayload) || typeof agentsPayload.selectionRequired !== "boolean") {
      throw new Error("agents.list returned an invalid ownership snapshot");
    }
    // The unknown key is a legacy ownerless sentinel. Preserve an existing
    // captured link only while the Gateway proves that its owner is unambiguous.
    includeUnknown = !agentsPayload.selectionRequired;
  }
  const payload = await gateway.request(
    "sessions.list",
    {
      limit: CANOPY_SESSION_SWEEP_LIMIT,
      configuredAgentsOnly: true,
      includeGlobal: false,
      includeUnknown,
    },
    { scopes: ["operator.read"] },
  );
  if (!isRecord(payload) || !Array.isArray(payload.sessions)) {
    throw new Error("sessions.list returned an invalid lifecycle snapshot");
  }
  return {
    sessions: payload.sessions.flatMap((value) => {
      const session = normalizeSession(value);
      return session ? [session] : [];
    }),
    // A short page proves the snapshot is complete. Keep full pages conservative
    // so absent sessions are never inferred as "missing" when the page is truncated.
    complete: payload.sessions.length < CANOPY_SESSION_SWEEP_LIMIT,
  };
}

export function createCanopyLifecycleService(params: {
  store: CanopyStore;
  worktrees?: CanopyWorktreeCleanupRuntime;
  readSessions: (
    options: CanopyLifecycleSessionReadOptions,
  ) => Promise<CanopyLifecycleSessionSnapshot>;
  onSweep?: () => void;
  now?: () => number;
}): CanopyLifecycleService {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let begin: (() => void) | undefined;
  let removeDrainListener: (() => void) | undefined;
  let cleanupCursor = 0;
  const cleanupWorktrees = async (
    cards: readonly CanopyCard[],
    warn: (message: string) => void,
  ) => {
    if (!params.worktrees) {
      return;
    }
    const candidates = cards.filter(isCanopyWorktreeCleanupCandidate);
    const start = cleanupCursor % Math.max(candidates.length, 1);
    const rotated = [...candidates.slice(start), ...candidates.slice(0, start)];
    const batch = rotated.slice(0, CANOPY_WORKTREE_CLEANUP_SWEEP_LIMIT);
    cleanupCursor = candidates.length === 0 ? 0 : (start + batch.length) % candidates.length;
    for (const card of batch) {
      try {
        await cleanupCanopyCardWorktree({
          store: params.store,
          worktrees: params.worktrees,
          card,
        });
      } catch (error) {
        warn(`canopy worktree cleanup failed for card ${card.id}: ${String(error)}`);
      }
    }
  };
  const stop = () => {
    removeDrainListener?.();
    removeDrainListener = undefined;
    generation += 1;
    begin = undefined;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const onGatewayStop = () => {
    canopyLifecycleGatewayState.ready = false;
    canopyLifecycleGatewayState.abortSignal = undefined;
    stop();
  };
  const beginWhenGatewayReady = () => {
    if (!canopyLifecycleGatewayState.ready) {
      return;
    }
    removeDrainListener?.();
    const signal = canopyLifecycleGatewayState.abortSignal;
    if (signal?.aborted) {
      onGatewayStop();
      return;
    }
    signal?.addEventListener("abort", onGatewayStop, { once: true });
    removeDrainListener = () => signal?.removeEventListener("abort", onGatewayStop);
    begin?.();
  };
  return {
    id: "canopy-lifecycle-sync",
    start(ctx) {
      const owner = ++generation;
      let begun = false;
      const reconcile = async () => {
        try {
          await params.store.runOperation(async () => {
            if (generation === owner) {
              params.onSweep?.();
            }
            let cards = await params.store.list();
            if (generation !== owner) {
              return;
            }
            if (cards.some((card) => needsCanopyLifecycleReconciliation(card))) {
              try {
                const snapshot = await params.readSessions({
                  includeUnknown: cards.some(
                    (card) => !card.metadata?.archivedAt && cardSessionKey(card) === "unknown",
                  ),
                });
                if (generation !== owner) {
                  return;
                }
                await syncCanopyLifecycleSessions({
                  store: params.store,
                  cards,
                  ...snapshot,
                  now: params.now?.() ?? Date.now(),
                });
                if (generation !== owner) {
                  return;
                }
                cards = await params.store.list();
              } catch (error) {
                if (generation === owner) {
                  ctx.logger.warn(`canopy lifecycle sync failed: ${String(error)}`);
                }
              }
            }
            if (generation === owner) {
              await cleanupWorktrees(cards, (message) => ctx.logger.warn(message));
            }
          });
        } catch (error) {
          if (generation === owner) {
            ctx.logger.warn(`canopy lifecycle recovery failed: ${String(error)}`);
          }
        } finally {
          if (generation === owner) {
            timer = setTimeout(() => void reconcile(), CANOPY_LIFECYCLE_SWEEP_MS);
            timer.unref?.();
          }
        }
      };
      begin = () => {
        if (generation !== owner || begun) {
          return;
        }
        begun = true;
        // The Gateway lifecycle signal owns the first bounded sweep; terminal
        // hooks keep end-state writes immediate between 60-second sweeps.
        void reconcile();
      };
      beginWhenGatewayReady();
    },
    stop,
    onGatewayStart(abortSignal) {
      canopyLifecycleGatewayState.ready = true;
      canopyLifecycleGatewayState.abortSignal = abortSignal;
      beginWhenGatewayReady();
    },
    onGatewayStop,
  };
}
