import type {
  CanopyBoardSummary,
  CanopyCard,
  CanopyDiagnostic,
  CanopyEvent,
  CanopyWorkspace,
  CanopyWorkspaceAccess,
} from "@branch/canopy-contract";

type CanopyCardInput = {
  title?: unknown;
  notes?: unknown;
  status?: unknown;
  priority?: unknown;
  labels?: unknown;
  agentId?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
  sourceUrl?: unknown;
  execution?: unknown;
  metadata?: unknown;
  templateId?: unknown;
  position?: unknown;
  tenant?: unknown;
  boardId?: unknown;
  createdByCardId?: unknown;
  idempotencyKey?: unknown;
  skills?: unknown;
  workspace?: unknown;
  /** Trusted mutation provenance; not accepted from public tool schemas. */
  workspaceAccess?: unknown;
  maxRuntimeSeconds?: unknown;
  maxRetries?: unknown;
  scheduledAt?: unknown;
  startedAt?: unknown;
  completedAt?: unknown;
  parents?: unknown;
};

export type CanopyCardPatch = CanopyCardInput;
export type CanopyUpdateCardOptions = {
  allowAutomationLaunch?: boolean;
  allowMetadataDependencyLinks?: boolean;
  enforceStatusHolds?: boolean;
  event?: Omit<CanopyEvent, "id" | "at">;
  eventAt?: number;
  expectedUpdatedAt?: number;
  ownerSlot?: { ownerId: string; now: number };
  preserveProofId?: string;
};
export type CanopyCommentInput = { body?: unknown };
export type CanopyLinkInput = {
  type?: unknown;
  targetCardId?: unknown;
  title?: unknown;
  url?: unknown;
};
export type CanopyLinkedCreateInput = CanopyCardInput;
export type CanopyProofInput = {
  status?: unknown;
  label?: unknown;
  command?: unknown;
  url?: unknown;
  note?: unknown;
};
export type CanopyArtifactInput = {
  label?: unknown;
  url?: unknown;
  path?: unknown;
  mimeType?: unknown;
};
export type CanopyAttachmentInput = {
  fileName?: unknown;
  contentBase64?: unknown;
  mimeType?: unknown;
  note?: unknown;
};
export type CanopyWorkerLogInput = {
  level?: unknown;
  message?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
};
export type CanopyProtocolViolationInput = {
  detail?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
};
export type CanopyClaimInput = {
  ownerId?: unknown;
  token?: unknown;
  ttlSeconds?: unknown;
};
export type CanopyClaimOptions = {
  assertOwnerCurrent?: () => void;
  /** Trusted dispatcher guard; never accepted from public tool or gateway input. */
  expectedAuthority?: {
    boardId: string;
    status: CanopyCard["status"];
    agentId?: string;
    workspace?: CanopyWorkspace;
    workspaceAccess?: CanopyWorkspaceAccess;
  };
  /** Trusted legacy-card adoption; applied only while expectedAuthority still matches. */
  adoptWorkspaceAccess?: CanopyWorkspaceAccess;
};
export type CanopyHeartbeatInput = {
  token?: unknown;
  ownerId?: unknown;
  note?: unknown;
};
export type CanopyBulkInput = {
  ids?: unknown;
  patch?: unknown;
  archived?: unknown;
};
export type CanopyCompleteInput = {
  ownerId?: unknown;
  token?: unknown;
  summary?: unknown;
  proof?: unknown;
  proofId?: unknown;
  artifacts?: unknown;
  createdCardIds?: unknown;
};
export type CanopyBlockInput = {
  ownerId?: unknown;
  token?: unknown;
  reason?: unknown;
};
export type CanopyDispatchResult = {
  promoted: CanopyCard[];
  reclaimed: CanopyCard[];
  blocked: CanopyCard[];
  orchestrated: CanopyCard[];
  count: number;
};
export type CanopyListOptions = {
  boardId?: unknown;
};
export type CanopyDispatchOptions = CanopyListOptions & {
  now?: unknown;
  assertOwnerCurrent?: () => void;
};
export type CanopyStatsResult = CanopyBoardSummary & {
  byAgent: Record<string, number>;
  oldestReadyAgeMs?: number;
};
export type CanopyPromoteInput = {
  force?: unknown;
  reason?: unknown;
};
export type CanopyReassignInput = {
  agentId?: unknown;
  status?: unknown;
  resetFailures?: unknown;
  reason?: unknown;
};
export type CanopyReclaimInput = {
  status?: unknown;
  reason?: unknown;
};
export type CanopyBoardInput = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  icon?: unknown;
  color?: unknown;
  clearAppearance?: unknown;
  automationJobId?: unknown;
  defaultWorkspace?: unknown;
  orchestration?: unknown;
  archived?: unknown;
};
export type CanopySpecifyInput = CanopyCardPatch & {
  summary?: unknown;
};
export type CanopyDecomposeChildInput = CanopyLinkedCreateInput;
export type CanopyDecomposeInput = {
  summary?: unknown;
  children?: unknown;
  completeParent?: unknown;
};
export type CanopyNotificationSubscribeInput = {
  boardId?: unknown;
  cardId?: unknown;
  sessionKey?: unknown;
  runId?: unknown;
  target?: unknown;
  eventKinds?: unknown;
};
export type CanopyNotificationListOptions = {
  boardId?: unknown;
  cardId?: unknown;
};
export type CanopyNotificationEventsInput = CanopyNotificationListOptions & {
  subscriptionId?: unknown;
  limit?: unknown;
};
export type CanopyMutationScope = {
  ownerId?: unknown;
  token?: unknown;
};

export type CanopyDiagnosticsResult = {
  diagnostics: Array<{
    card: CanopyCard;
    diagnostics: CanopyDiagnostic[];
  }>;
  count: number;
};
