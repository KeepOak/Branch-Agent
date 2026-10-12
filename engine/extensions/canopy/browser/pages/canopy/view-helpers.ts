import type { CronJob } from "@branch/gateway-protocol";
import { html, type TemplateResult } from "lit";
import type { ControlUiHost } from "branch/plugin-sdk/control-ui";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { GatewaySessionRow } from "../../api/types.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { formatDateTimeMs } from "../../lib/format.ts";
import {
  getCanopyState,
  canopyMutationsReady,
  type CanopyCard,
  type CanopyEvent,
  type CanopyExecutionEngine,
  type CanopyLifecycle,
  type CanopyPriority,
  type CanopyStatus,
  type CanopyUiState,
} from "../../lib/canopy/index.ts";
import { isReservedSessionKey } from "../../lib/canopy/session-links.ts";
import type { CanopySessionResolution } from "../../lib/canopy/session-resolution.ts";
import { agentDisplayName, findCardAgent, type CanopyAgentsList } from "./agent-filter.ts";

export type BoardAutomationState = { jobId: string } & (
  | { status: "loading" }
  | { status: "loaded"; job: CronJob }
  | { status: "unavailable"; error: string }
);

export type CanopyProps = {
  heading?: TemplateResult;
  scopeControl?: TemplateResult;
  pageError?: string | null;
  overlayOpen?: boolean;
  presented?: boolean;
  detailBoardAutomation?: BoardAutomationState;
  host: object;
  client: GatewayBrowserClient | null;
  connected: boolean;
  canWrite?: boolean;
  canGrant?: boolean;
  canModelOverride?: boolean;
  agentsList: CanopyAgentsList | null;
  defaultAgentId?: string | null;
  sessions: GatewaySessionRow[];
  sessionResolution?: CanopySessionResolution;
  scopeAgentId?: string | null;
  onClearAgentScope?: () => void;
  showAgentFilter?: boolean;
  onOpenSession: ControlUiHost["sessions"]["open"];
  onBoardFilterChange?: (boardFilter: string) => void;
  onNewBoard?: () => void;
  onRequestUpdate?: () => void;
};

const eventLabelKeys: Record<CanopyEvent["kind"], string> = {
  created: "canopy.eventCreated",
  edited: "canopy.eventEdited",
  moved: "canopy.eventMoved",
  linked: "canopy.eventLinked",
  specified: "canopy.eventSpecified",
  decomposed: "canopy.eventDecomposed",
  claimed: "canopy.eventClaimed",
  heartbeat: "canopy.eventHeartbeat",
  execution_updated: "canopy.eventExecutionUpdated",
  attempt_started: "canopy.eventAttemptStarted",
  attempt_updated: "canopy.eventAttemptUpdated",
  comment_added: "canopy.eventCommentAdded",
  link_added: "canopy.eventLinkAdded",
  proof_added: "canopy.eventProofAdded",
  artifact_added: "canopy.eventArtifactAdded",
  attachment_added: "canopy.eventAttachmentAdded",
  diagnostic: "canopy.eventDiagnostic",
  notification: "canopy.eventNotification",
  dispatch: "canopy.eventDispatch",
  orchestration: "canopy.eventOrchestration",
  protocol_violation: "canopy.eventProtocolViolation",
  archived: "canopy.eventArchived",
  unarchived: "canopy.eventUnarchived",
  stale: "canopy.eventStale",
};

type LifecycleCopy = readonly [
  labelKey: string,
  detailKey: string | undefined,
  tone: "blocked" | "done" | "idle" | "live",
];

const lifecycleCopy = {
  queued: ["sessionsView.statusQueued", undefined, "idle"],
  running: ["canopy.lifecycleRunning", "canopy.lifecycleRunningDetail", "live"],
  succeeded: ["canopy.lifecycleDone", "canopy.lifecycleDoneDetail", "done"],
  failed: ["canopy.lifecycleFailed", "canopy.lifecycleFailedDetail", "blocked"],
  stale: ["canopy.lifecycleStale", "canopy.lifecycleStaleDetail", "blocked"],
  idle: ["canopy.lifecycleLinked", "canopy.lifecycleIdleDetail", "idle"],
  unknown: ["canopy.lifecycleUnknown", "canopy.lifecycleUnknownDetail", "idle"],
  unavailable: ["canopy.lifecycleUnavailable", "canopy.lifecycleUnavailableDetail", "idle"],
  ambiguous: ["canopy.lifecycleAmbiguous", "canopy.lifecycleAmbiguousDetail", "blocked"],
  unlinked: ["canopy.lifecycleUnlinked", "canopy.lifecycleUnlinkedDetail", "idle"],
} as const satisfies Record<CanopyLifecycle["state"], LifecycleCopy>;

export const formatStatusLabel = (status: CanopyStatus) => t(`canopy.status.${status}`);

export const formatPriorityLabel = (priority: CanopyPriority) =>
  priority.charAt(0).toUpperCase() + priority.slice(1);

const priorityIcons = {
  low: icons.priorityLow,
  normal: icons.priorityNormal,
  high: icons.priorityHigh,
  urgent: icons.priorityUrgent,
} satisfies Record<CanopyPriority, TemplateResult>;

export const renderPriorityIcon = (priority: CanopyPriority) => priorityIcons[priority];

function formatRefreshTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatUpdatedTime(value: number | undefined): string {
  return value
    ? formatDateTimeMs(
        value,
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
        "",
      )
    : "";
}

export function dispatchSummaryMessage(state: CanopyUiState) {
  const summary = state.lastDispatchSummary;
  if (!summary) {
    return "";
  }
  const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
  return t(total === 0 ? "canopy.dispatchSummaryEmpty" : "canopy.dispatchSummary", {
    started: String(summary.started),
    failures: String(summary.failures),
    promoted: String(summary.promoted),
    blocked: String(summary.blocked),
    reclaimed: String(summary.reclaimed),
    orchestrated: String(summary.orchestrated),
  });
}

export function refreshStatusLabel(state: CanopyUiState) {
  if (state.lastRefreshAt) {
    return state.lastRefreshError
      ? t("canopy.refreshError")
      : t("canopy.lastRefreshed", { time: formatRefreshTime(state.lastRefreshAt) });
  }
  return state.lastRefreshError ? t("canopy.refreshError") : "";
}

export function canopyErrorMessage(
  state: Pick<CanopyUiState, "error" | "lastRefreshError">,
  pageError?: string | null,
) {
  return state.error ?? pageError ?? state.lastRefreshError;
}

export function canMutate(props: CanopyProps): boolean {
  return props.canWrite !== false && canopyMutationsReady(getCanopyState(props.host));
}

export function formatEventLabel(event: CanopyEvent): string {
  if (event.kind === "moved" && event.toStatus) {
    return t("canopy.eventMovedTo", { status: formatStatusLabel(event.toStatus) });
  }
  return t(eventLabelKeys[event.kind]);
}

export function matchesCardQuery(card: CanopyCard, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return [
    card.id,
    card.title,
    card.notes,
    card.agentId,
    card.sessionKey,
    card.execution?.engine,
    card.execution?.mode,
    card.execution?.model,
    card.execution?.sessionKey,
    card.metadata?.templateId,
    card.metadata?.automation?.tenant,
    card.metadata?.automation?.idempotencyKey,
    card.metadata?.automation?.workspace?.kind,
    card.metadata?.automation?.workspace?.path,
    card.metadata?.automation?.workspace?.branch,
    ...(card.metadata?.automation?.skills ?? []),
    ...(card.metadata?.automation?.createdCardIds ?? []),
    ...(card.metadata?.comments ?? []).map((comment) => comment.body),
    ...(card.metadata?.links ?? []).flatMap((link) => [link.title, link.url, link.targetCardId]),
    ...(card.metadata?.proof ?? []).flatMap((proof) => [
      proof.label,
      proof.command,
      proof.url,
      proof.note,
    ]),
    ...(card.metadata?.artifacts ?? []).flatMap((artifact) => [
      artifact.label,
      artifact.url,
      artifact.path,
      artifact.mimeType,
    ]),
    ...(card.metadata?.attachments ?? []).flatMap((attachment) => [
      attachment.fileName,
      attachment.mimeType,
      attachment.note,
    ]),
    ...(card.metadata?.workerLogs ?? []).map((log) => log.message),
    card.metadata?.workerProtocol?.state,
    card.metadata?.workerProtocol?.detail,
    card.metadata?.claim?.ownerId,
    ...(card.metadata?.diagnostics ?? []).flatMap((diagnostic) => [
      diagnostic.kind,
      diagnostic.severity,
      diagnostic.title,
      diagnostic.detail,
    ]),
    ...(card.metadata?.notifications ?? []).map((notification) => notification.message),
    ...card.labels,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(query));
}

export function isCanopySessionChoice(session: GatewaySessionRow): boolean {
  if (session.archived || isReservedSessionKey(session.key)) {
    return false;
  }
  const raw = [session.key, session.label, session.displayName]
    .filter((value): value is string => typeof value === "string")
    .join(":")
    .toLowerCase();
  return !/(^|:)heartbeat(:|$)/.test(raw);
}

export function engineBlockedByRuntime(
  props: CanopyProps,
  card: CanopyCard,
  engine: CanopyExecutionEngine | null,
): string | null {
  if (!engine) {
    return null;
  }
  const agent = findCardAgent(card, props.agentsList);
  const runtime = agent?.agentRuntime?.id?.trim();
  if (!runtime) {
    return null;
  }
  const normalized = runtime.toLowerCase();
  if (normalized === "branch" || normalized === "pi") {
    return null;
  }
  return t("canopy.engineDisabledRuntime", {
    agent: agentDisplayName(agent, card.agentId ?? t("canopy.defaultAgent")),
    runtime,
  });
}

export function formatLifecycle(lifecycle: CanopyLifecycle): {
  label: string;
  detail: string | undefined;
  tone: "blocked" | "done" | "idle" | "live";
} {
  if (lifecycle.state === "failed") {
    if (lifecycle.session?.status === "timeout") {
      return {
        label: t("canopy.lifecycleTimedOut"),
        detail: t("canopy.lifecycleFailedDetail"),
        tone: "blocked",
      };
    }
    if (lifecycle.session?.status === "killed" || lifecycle.session?.abortedLastRun) {
      return {
        label: t("canopy.lifecycleStopped"),
        detail: t("canopy.lifecycleStoppedDetail"),
        tone: "idle",
      };
    }
  }
  const [labelKey, detailKey, tone] = lifecycleCopy[lifecycle.state];
  return { label: t(labelKey), detail: detailKey === undefined ? undefined : t(detailKey), tone };
}

export function cardHasUnresolvedStartedRun(card: CanopyCard): boolean {
  const sessionKey = card.sessionKey ?? card.execution?.sessionKey;
  const runId = card.runId ?? card.execution?.runId;
  return card.status === "running" && Boolean(sessionKey && runId);
}

export function renderLifecycleIcon(lifecycle: CanopyLifecycle) {
  if (lifecycle.state === "running") {
    return html`<span class="session-run-spinner" aria-hidden="true"></span>`;
  }
  const icon =
    lifecycle.state === "failed" &&
    (lifecycle.session?.status === "killed" || lifecycle.session?.abortedLastRun)
      ? icons.stop
      : lifecycle.state === "queued"
        ? icons.hourglass
        : lifecycle.state === "stale"
          ? icons.alertTriangle
          : lifecycle.state === "succeeded"
            ? icons.check
            : lifecycle.state === "idle" || lifecycle.state === "unlinked"
              ? icons.messageSquare
              : icons.alertTriangle;
  return html`<span class="canopy-card__session-icon" aria-hidden="true">${icon}</span>`;
}
