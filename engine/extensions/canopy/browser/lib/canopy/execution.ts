import type { BoardGetParams } from "@branch/gateway-protocol";
import { isRecord, truncateUtf16Safe } from "branch/plugin-sdk/string-coerce-runtime";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { requestSessionCreate } from "../sessions/create.ts";
import { replaceCard, canopyCardRunId, canopyCardSessionKey } from "./card-state.ts";
import { formatError } from "./normalization-utils.ts";
import { normalizeCardPayload } from "./normalization.ts";
import {
  getCanopyState,
  invalidateCanopyLoads,
  canopyMutationsReady,
  type CanopyHost,
} from "./runtime.ts";
import { canopyCardSessionTarget } from "./session-resolution.ts";
import type {
  CanopyCard,
  CanopyExecution,
  CanopyExecutionEngine,
  CanopyExecutionMode,
  CanopyUiState,
} from "./types.ts";

const CANOPY_ENGINE_MODELS = {
  codex: "openai/gpt-6-astra",
  claude: "anthropic/claude-sonnet-4-6",
} as const;
const CANOPY_SESSION_LABEL_MAX_CHARS = 512;

export function canStartCanopyCard(card: CanopyCard): boolean {
  return !canopyCardSessionKey(card);
}

function assertCurrentCard(state: CanopyUiState, card: CanopyCard): void {
  const current = state.cards.find((candidate) => candidate.id === card.id);
  // Page hiding closes admission; an existing action still owns this revision.
  if (!current || current.updatedAt !== card.updatedAt) {
    throw new Error("This card changed. Refresh its details before starting or stopping it.");
  }
}

function engineModel(engine: CanopyExecutionEngine | null | undefined): string | undefined {
  return engine === "codex"
    ? CANOPY_ENGINE_MODELS.codex
    : engine === "claude"
      ? CANOPY_ENGINE_MODELS.claude
      : undefined;
}

function buildCardSessionLabel(card: CanopyCard): string {
  const suffix = card.id.trim().slice(0, 8) || "card";
  const title = card.title.trim() || "Canopy card";
  const suffixText = ` (${suffix})`;
  if (title.length + suffixText.length <= CANOPY_SESSION_LABEL_MAX_CHARS) {
    return `${title}${suffixText}`;
  }
  const titleMax = CANOPY_SESSION_LABEL_MAX_CHARS - suffixText.length;
  return `${truncateUtf16Safe(title, titleMax - 3).trimEnd()}...${suffixText}`;
}

function isScheduledForLater(card: CanopyCard, now = Date.now()): boolean {
  const scheduledAt = card.metadata?.automation?.scheduledAt;
  if (typeof scheduledAt === "number") {
    return scheduledAt > now;
  }
  return card.status === "scheduled";
}

function buildManualCanopyExecution(params: {
  card: CanopyCard;
  engine: CanopyExecutionEngine;
  sessionKey?: string | null;
}): CanopyExecution {
  const now = Date.now();
  const model = engineModel(params.engine);
  return {
    id: params.card.execution?.id ?? `${params.card.id}:agent-session`,
    kind: "agent-session",
    engine: params.engine,
    mode: "manual",
    status: "idle",
    startedAt: now,
    updatedAt: now,
    ...(model ? { model } : {}),
    ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
  };
}

function canopyRunWasAborted(result: unknown): boolean {
  return (
    isRecord(result) &&
    (result.aborted === true || (Array.isArray(result.runIds) && result.runIds.length > 0))
  );
}

async function abortCanopySessionRun(params: {
  client: GatewayBrowserClient;
  session: BoardGetParams;
  runId?: string;
  assertCurrent: () => void;
}): Promise<boolean> {
  const targetedAbort = await params.client.request("chat.abort", {
    ...params.session,
    ...(params.runId ? { runId: params.runId } : {}),
  });
  params.assertCurrent();
  const aborted = canopyRunWasAborted(targetedAbort);
  if (aborted || !params.runId) {
    return aborted;
  }
  // A card run id that no longer names the live run aborts nothing, so retry
  // session-wide before reporting failure; otherwise Stop strands an active run.
  return canopyRunWasAborted(await params.client.request("chat.abort", params.session));
}

export async function startCanopyCard(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  card: CanopyCard;
  engine?: CanopyExecutionEngine;
  mode?: CanopyExecutionMode;
  requestUpdate?: () => void;
}): Promise<string | null> {
  const state = getCanopyState(params.host);
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    state.dispatching ||
    state.busyCardIds.has(params.card.id)
  ) {
    return null;
  }
  const engine = params.engine;
  const mode = params.mode ?? "autonomous";
  const model = engineModel(engine);
  state.error = null;
  if (mode === "autonomous" && isScheduledForLater(params.card)) {
    state.error = "Scheduled cards cannot start before their scheduled time.";
    params.requestUpdate?.();
    return null;
  }
  invalidateCanopyLoads(params.host);
  state.busyCardIds.add(params.card.id);
  params.requestUpdate?.();
  try {
    assertCurrentCard(state, params.card);
    if (!canStartCanopyCard(params.card)) {
      throw new Error(
        "This card already has an execution. Refresh its details or use Edit to clear its session link before starting another.",
      );
    }
    if (mode === "autonomous") {
      const separator = model?.indexOf("/") ?? -1;
      const payload = await params.client.request("canopy.cards.start", {
        id: params.card.id,
        ...(separator > 0
          ? { provider: model?.slice(0, separator), model: model?.slice(separator + 1) }
          : {}),
      });
      assertCurrentCard(state, params.card);
      const card = normalizeCardPayload(payload);
      replaceCard(state, card);
      const sessionKey = canopyCardSessionKey(card);
      return sessionKey ?? null;
    }
    const shouldClearManualSchedule = params.card.metadata?.automation?.scheduledAt !== undefined;
    const shouldUnscheduleManual = params.card.status === "scheduled";
    const nextCardStatus = shouldUnscheduleManual ? "todo" : params.card.status;
    const sessionKey = await requestSessionCreate(params.client, {
      ...(params.card.agentId ? { agentId: params.card.agentId } : {}),
      label: buildCardSessionLabel(params.card),
      ...(model ? { model } : {}),
    });
    assertCurrentCard(state, params.card);
    const payload = await params.client.request("canopy.cards.update", {
      id: params.card.id,
      expectedUpdatedAt: params.card.updatedAt,
      patch: {
        status: nextCardStatus,
        ...(shouldClearManualSchedule ? { scheduledAt: null } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        runId: null,
        ...(engine
          ? {
              execution: buildManualCanopyExecution({
                card: params.card,
                engine,
                sessionKey,
              }),
            }
          : { execution: null }),
      },
    });
    assertCurrentCard(state, params.card);
    replaceCard(state, normalizeCardPayload(payload));
    return sessionKey;
  } catch (error) {
    state.error = formatError(error);
    return null;
  } finally {
    state.busyCardIds.delete(params.card.id);
    params.requestUpdate?.();
  }
}

export async function stopCanopyCard(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  card: CanopyCard;
  session?: BoardGetParams;
  requestUpdate?: () => void;
}) {
  const state = getCanopyState(params.host);
  const linkedSessionKey = canopyCardSessionKey(params.card);
  const session = canopyCardSessionTarget(params.card, params.session);
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    state.dispatching ||
    state.busyCardIds.has(params.card.id) ||
    !linkedSessionKey
  ) {
    return;
  }
  invalidateCanopyLoads(params.host);
  state.busyCardIds.add(params.card.id);
  state.error = null;
  params.requestUpdate?.();
  const assertCurrent = () => assertCurrentCard(state, params.card);
  try {
    assertCurrent();
    const sessionAborted = session
      ? await abortCanopySessionRun({
          client: params.client,
          session,
          runId: canopyCardRunId(params.card),
          assertCurrent,
        })
      : false;
    assertCurrent();
    if (!sessionAborted) {
      if (!session) {
        throw new Error(
          "Refresh this card's session details before stopping it, or use Edit to choose its session.",
        );
      }
      return;
    }
    const payload = await params.client.request("canopy.cards.update", {
      id: params.card.id,
      expectedUpdatedAt: params.card.updatedAt,
      patch: {
        status: "blocked",
        ...(params.card.execution
          ? {
              execution: {
                ...params.card.execution,
                status: "blocked",
                updatedAt: Date.now(),
              },
            }
          : {}),
      },
    });
    assertCurrent();
    replaceCard(state, normalizeCardPayload(payload));
  } catch (error) {
    state.error = formatError(error);
  } finally {
    state.busyCardIds.delete(params.card.id);
    params.requestUpdate?.();
  }
}
