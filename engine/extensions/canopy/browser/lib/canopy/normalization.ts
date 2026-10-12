import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import {
  normalizeEvents,
  normalizeExecution,
  normalizeMetadata,
} from "./metadata-normalization.ts";
import {
  isValidCanopyBoardId,
  normalizeCanopySessionsBoardSpec,
  CANOPY_PRIORITIES,
  CANOPY_STATUSES,
  type CanopyBoardSummary,
  type CanopyCard,
  type CanopyPriority,
  type CanopyStatus,
} from "./types.ts";

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function normalizeBoardSummary(value: unknown): CanopyBoardSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!isValidCanopyBoardId(id)) {
    return null;
  }
  const byStatus: Partial<Record<CanopyStatus, number>> = {};
  if (isRecord(value.byStatus)) {
    for (const status of CANOPY_STATUSES) {
      if (value.byStatus[status] !== undefined) {
        byStatus[status] = normalizeCount(value.byStatus[status]);
      }
    }
  }
  const automationJobId =
    typeof value.automationJobId === "string" ? value.automationJobId.trim() : "";
  return {
    id,
    ...(value.kind === "sessions"
      ? { kind: "sessions" as const, sessions: normalizeCanopySessionsBoardSpec(value.sessions) }
      : {}),
    total: normalizeCount(value.total),
    active: normalizeCount(value.active),
    archived: normalizeCount(value.archived),
    byStatus,
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(typeof value.description === "string" && value.description.trim()
      ? { description: value.description.trim() }
      : {}),
    ...(typeof value.icon === "string" && value.icon.trim() ? { icon: value.icon.trim() } : {}),
    ...(typeof value.color === "string" && value.color.trim() ? { color: value.color.trim() } : {}),
    ...(automationJobId && automationJobId.length <= 128 ? { automationJobId } : {}),
    ...(typeof value.updatedAt === "number" ? { updatedAt: value.updatedAt } : {}),
    ...(typeof value.archivedAt === "number" ? { archivedAt: value.archivedAt } : {}),
  };
}

function normalizeCard(value: unknown): CanopyCard | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id : "";
  const title = typeof value.title === "string" ? value.title : "";
  const status = CANOPY_STATUSES.includes(value.status as CanopyStatus)
    ? (value.status as CanopyStatus)
    : "todo";
  const priority = CANOPY_PRIORITIES.includes(value.priority as CanopyPriority)
    ? (value.priority as CanopyPriority)
    : "normal";
  if (!id || !title) {
    return null;
  }
  const execution = normalizeExecution(value.execution);
  const events = normalizeEvents(value.events);
  const metadata = normalizeMetadata(value.metadata);
  return {
    id,
    title,
    status,
    priority,
    labels: Array.isArray(value.labels)
      ? value.labels.filter((label): label is string => typeof label === "string")
      : [],
    position: typeof value.position === "number" ? value.position : 0,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
    ...(typeof value.agentId === "string" ? { agentId: value.agentId } : {}),
    ...(typeof value.sessionKey === "string" ? { sessionKey: value.sessionKey } : {}),
    ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
    ...(typeof value.sourceUrl === "string" ? { sourceUrl: value.sourceUrl } : {}),
    ...(execution ? { execution } : {}),
    ...(typeof value.startedAt === "number" ? { startedAt: value.startedAt } : {}),
    ...(typeof value.completedAt === "number" ? { completedAt: value.completedAt } : {}),
    ...(events.length ? { events } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeCardsPayload(payload: unknown): {
  cards: CanopyCard[];
  boards: CanopyBoardSummary[];
  statuses: readonly CanopyStatus[];
} {
  if (!isRecord(payload)) {
    return { cards: [], boards: [], statuses: CANOPY_STATUSES };
  }
  const cards = Array.isArray(payload.cards)
    ? payload.cards.map(normalizeCard).filter((card): card is CanopyCard => card !== null)
    : [];
  const statuses = Array.isArray(payload.statuses)
    ? payload.statuses.filter((status): status is CanopyStatus =>
        CANOPY_STATUSES.includes(status as CanopyStatus),
      )
    : CANOPY_STATUSES;
  const boards = Array.isArray(payload.boards)
    ? payload.boards
        .map(normalizeBoardSummary)
        .filter((board): board is CanopyBoardSummary => board !== null)
    : [];
  return { cards, boards, statuses: statuses.length ? statuses : CANOPY_STATUSES };
}

export function normalizeCardPayload(payload: unknown): CanopyCard {
  const card = isRecord(payload) ? normalizeCard(payload.card) : null;
  if (!card) {
    throw new Error("canopy response did not include a card");
  }
  return card;
}
