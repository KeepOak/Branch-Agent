import type { CanopySessionsBoardSpec } from "./sessions-board.js";

export const CANOPY_STATUSES = [
  "triage",
  "backlog",
  "todo",
  "scheduled",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
] as const;

export const CANOPY_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
/** Built-in launch choices. Persisted execution engines remain an open runtime identifier. */
export const CANOPY_EXECUTION_ENGINES = ["codex", "claude"] as const;
export const CANOPY_EXECUTION_MODES = ["autonomous", "manual"] as const;
export const CANOPY_EXECUTION_STATUSES = [
  "idle",
  "running",
  "review",
  "blocked",
  "done",
] as const;
export const CANOPY_EVENT_KINDS = [
  "created",
  "edited",
  "moved",
  "linked",
  "specified",
  "decomposed",
  "claimed",
  "heartbeat",
  "execution_updated",
  "attempt_started",
  "attempt_updated",
  "comment_added",
  "link_added",
  "proof_added",
  "artifact_added",
  "attachment_added",
  "diagnostic",
  "notification",
  "dispatch",
  "orchestration",
  "protocol_violation",
  "archived",
  "unarchived",
  "stale",
] as const;
export const CANOPY_ATTEMPT_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "blocked",
  "stopped",
] as const;
export const CANOPY_LINK_TYPES = [
  "parent",
  "child",
  "blocks",
  "blocked_by",
  "relates_to",
] as const;
export const CANOPY_PROOF_STATUSES = ["passed", "failed", "skipped", "unknown"] as const;
export const CANOPY_TEMPLATE_IDS = ["bugfix", "docs", "release", "pr_review", "plugin"] as const;
export const CANOPY_DIAGNOSTIC_KINDS = [
  "stranded_ready",
  "running_without_heartbeat",
  "blocked_too_long",
  "repeated_failures",
  "missing_proof",
  "orphaned_session",
  "archived_but_active",
] as const;
export const CANOPY_DIAGNOSTIC_SEVERITIES = ["warning", "error", "critical"] as const;
export const CANOPY_NOTIFICATION_KINDS = ["completed", "failed", "stale"] as const;
export const CANOPY_BOARD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export function isValidCanopyBoardId(value: unknown): value is string {
  return typeof value === "string" && CANOPY_BOARD_ID_PATTERN.test(value);
}

export type CanopyDeleteResult = {
  deleted: boolean;
  referenceUpdates?: Array<{ id: string; previousUpdatedAt: number; updatedAt: number }>;
};

export type CanopyStatus = (typeof CANOPY_STATUSES)[number];
export type CanopyPriority = (typeof CANOPY_PRIORITIES)[number];
export type CanopyExecutionEngine = string;
export type CanopyExecutionMode = (typeof CANOPY_EXECUTION_MODES)[number];
export type CanopyExecutionStatus = (typeof CANOPY_EXECUTION_STATUSES)[number];
export type CanopyEventKind = (typeof CANOPY_EVENT_KINDS)[number];
export type CanopyAttemptStatus = (typeof CANOPY_ATTEMPT_STATUSES)[number];
export type CanopyLinkType = (typeof CANOPY_LINK_TYPES)[number];
export type CanopyProofStatus = (typeof CANOPY_PROOF_STATUSES)[number];
export type CanopyTemplateId = (typeof CANOPY_TEMPLATE_IDS)[number];
export type CanopyDiagnosticKind = (typeof CANOPY_DIAGNOSTIC_KINDS)[number];
export type CanopyDiagnosticSeverity = (typeof CANOPY_DIAGNOSTIC_SEVERITIES)[number];
export type CanopyNotificationKind = (typeof CANOPY_NOTIFICATION_KINDS)[number];

export type CanopyExecution = {
  id: string;
  kind: "agent-session";
  engine?: CanopyExecutionEngine;
  mode: CanopyExecutionMode;
  status: CanopyExecutionStatus;
  model?: string;
  sessionKey?: string;
  runId?: string;
  startedAt: number;
  updatedAt: number;
};

export type CanopyEvent = {
  id: string;
  kind: CanopyEventKind;
  at: number;
  fromStatus?: CanopyStatus;
  toStatus?: CanopyStatus;
  sessionKey?: string;
  runId?: string;
};

export type CanopyRunAttempt = {
  id: string;
  status: CanopyAttemptStatus;
  startedAt: number;
  endedAt?: number;
  engine?: CanopyExecutionEngine;
  mode?: CanopyExecutionMode;
  model?: string;
  sessionKey?: string;
  runId?: string;
  error?: string;
};

export type CanopyComment = {
  id: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
};

export type CanopyLink = {
  id: string;
  type: CanopyLinkType;
  createdAt: number;
  targetCardId?: string;
  title?: string;
  url?: string;
};

export type CanopyProof = {
  id: string;
  status: CanopyProofStatus;
  createdAt: number;
  label?: string;
  command?: string;
  url?: string;
  note?: string;
};

export type CanopyArtifact = {
  id: string;
  createdAt: number;
  label?: string;
  url?: string;
  path?: string;
  mimeType?: string;
};

export type CanopyAttachment = {
  id: string;
  cardId: string;
  createdAt: number;
  fileName: string;
  byteSize: number;
  mimeType?: string;
  note?: string;
};

export type CanopyWorkerLog = {
  id: string;
  createdAt: number;
  level: "info" | "warning" | "error";
  message: string;
  sessionKey?: string;
  runId?: string;
};

export type CanopyWorkerProtocol = {
  state: "idle" | "running" | "completed" | "blocked" | "violated";
  updatedAt: number;
  detail?: string;
};

export type CanopyStaleState = {
  detectedAt: number;
  lastSessionUpdatedAt?: number;
  reason: string;
};

export type CanopyClaim = {
  ownerId: string;
  token: string;
  claimedAt: number;
  lastHeartbeatAt: number;
  expiresAt?: number;
};

export type CanopyDiagnosticAction = {
  kind: "claim" | "unblock" | "promote" | "reclaim" | "reassign" | "add_proof" | "open_session";
  label: string;
};

export type CanopyDiagnostic = {
  kind: CanopyDiagnosticKind;
  severity: CanopyDiagnosticSeverity;
  title: string;
  detail: string;
  firstSeenAt: number;
  lastSeenAt: number;
  count: number;
  actions: CanopyDiagnosticAction[];
};

export type CanopyNotification = {
  id: string;
  kind: CanopyNotificationKind;
  createdAt: number;
  sequence?: number;
  message: string;
  sessionKey?: string;
  runId?: string;
};

export const CANOPY_CHANGED_EVENT = "plugin.canopy.changed";

export type CanopyChange = {
  epoch: string;
  revision: number;
};

export type CanopyWorkspace = {
  kind: "scratch" | "dir" | "worktree";
  path?: string;
  branch?: string;
  sourcePath?: string;
  sourceBranch?: string;
};

export type CanopyWorkspaceAccess =
  | { unrestricted: true }
  | { unrestricted: false; roots: string[]; writable: boolean };

type CanopyLaunchIdentity = {
  requestedSessionKey: string;
  provisionalRunId: string;
  preparedAt: number;
};

export type CanopyLaunchState =
  | (CanopyLaunchIdentity & { phase: "prepared" })
  | (CanopyLaunchIdentity & {
      phase: "accepted";
      acceptedAt: number;
      acceptedSessionKey: string;
      acceptedRunId?: string;
    })
  | (CanopyLaunchIdentity & {
      phase: "failed";
      failedAt: number;
      reason: string;
    });

export type CanopyAutomation = {
  tenant?: string;
  boardId?: string;
  createdByCardId?: string;
  idempotencyKey?: string;
  skills?: string[];
  workspace?: CanopyWorkspace;
  workspaceAccess?: CanopyWorkspaceAccess;
  maxRuntimeSeconds?: number;
  maxRetries?: number;
  scheduledAt?: number;
  summary?: string;
  createdCardIds?: string[];
  dispatchCount?: number;
  lastDispatchAt?: number;
  launch?: CanopyLaunchState;
};

export type CanopyBoardMetadata = {
  id: string;
  kind?: "cards" | "sessions";
  sessions?: CanopySessionsBoardSpec;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  automationJobId?: string;
  defaultWorkspace?: CanopyWorkspace;
  orchestration?: CanopyOrchestrationSettings;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

export type CanopyBoardSummary = {
  id: string;
  kind?: "cards" | "sessions";
  sessions?: CanopySessionsBoardSpec;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  automationJobId?: string;
  defaultWorkspace?: CanopyWorkspace;
  orchestration?: CanopyOrchestrationSettings;
  total: number;
  active: number;
  archived: number;
  byStatus: Partial<Record<CanopyStatus, number>>;
  updatedAt?: number;
  archivedAt?: number;
};

export type CanopyOrchestrationSettings = {
  autoDecompose?: boolean;
  autoDecomposePerDispatch?: number;
  defaultAssignee?: string;
  orchestratorProfile?: string;
};

export type CanopyNotificationSubscription = {
  id: string;
  boardId: string;
  cardId?: string;
  sessionKey?: string;
  runId?: string;
  target?: string;
  eventKinds?: CanopyNotificationKind[];
  lastEventAt?: number;
  lastEventId?: string;
  lastEventSequence?: number;
  deliveredEventIds?: string[];
  createdAt: number;
  updatedAt: number;
};

export type CanopyMetadata = {
  attempts?: CanopyRunAttempt[];
  comments?: CanopyComment[];
  links?: CanopyLink[];
  proof?: CanopyProof[];
  artifacts?: CanopyArtifact[];
  attachments?: CanopyAttachment[];
  workerLogs?: CanopyWorkerLog[];
  workerProtocol?: CanopyWorkerProtocol;
  automation?: CanopyAutomation;
  claim?: CanopyClaim;
  diagnostics?: CanopyDiagnostic[];
  notifications?: CanopyNotification[];
  templateId?: CanopyTemplateId;
  archivedAt?: number;
  stale?: CanopyStaleState;
  lifecycleStatusSourceUpdatedAt?: number;
  failureCount?: number;
};

export type CanopyCard = {
  id: string;
  title: string;
  notes?: string;
  status: CanopyStatus;
  priority: CanopyPriority;
  labels: string[];
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  sourceUrl?: string;
  execution?: CanopyExecution;
  position: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  events?: CanopyEvent[];
  metadata?: CanopyMetadata;
};

export type CanopyListResult = {
  cards: CanopyCard[];
  statuses: readonly CanopyStatus[];
};
export {
  createDefaultCanopySessionsBoardSpec,
  normalizeCanopySessionsBoardSpec,
  patchCanopySessionsBoardSpec,
} from "./sessions-board.js";
export type {
  CanopySessionFacts,
  CanopySessionPlacement,
  CanopySessionsBoard,
  CanopySessionsBoardRead,
  CanopySessionsBoardSpec,
  CanopySessionsBoardView,
  CanopySessionsColumn,
  CanopySessionsColumnMatch,
  CanopySessionsObserverHealth,
} from "./sessions-board.js";
