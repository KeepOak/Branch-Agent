import type {
  CanopyBoardSummary,
  CanopyCard,
  CanopyPriority,
  CanopyStatus,
  CanopyTemplateId,
} from "@branch/canopy-contract";
import type { GatewaySessionRow } from "../../api/types.ts";

export * from "@branch/canopy-contract";
export type { CanopyBoardSummary } from "@branch/canopy-contract";

type CanopyLifecycleState =
  | "unlinked"
  | "unknown"
  | "unavailable"
  | "ambiguous"
  | "idle"
  | "queued"
  | "running"
  | "stale"
  | "succeeded"
  | "failed";

export type CanopyLifecycle = {
  session: GatewaySessionRow | null;
  state: CanopyLifecycleState;
};

type CanopyDependencyParent = {
  id: string;
  title: string;
  status?: CanopyStatus;
  done: boolean;
  missing: boolean;
};

export type CanopyDependencyState = {
  parents: CanopyDependencyParent[];
  blockedParents: CanopyDependencyParent[];
};

export type CanopyDispatchSummary = {
  started: number;
  failures: number;
  promoted: number;
  blocked: number;
  reclaimed: number;
  orchestrated: number;
};

export type CanopyRefreshSource = "initial" | "manual" | "live";

export type CanopyHealthKey = "stale" | "missingProof";

export type CanopyBulkDialog =
  | { kind: "delete"; cardIds: string[]; observedCards: CanopyCard[] }
  | {
      kind: "edit";
      cardIds: string[];
      observedCards: CanopyCard[];
      priority: CanopyPriority | "";
      agentId: string;
      labels: string;
      labelMode: "keep" | "add" | "replace" | "remove";
    };

export type CanopyUiState = {
  loading: boolean;
  loaded: boolean;
  loadAttempted: boolean;
  mutationReadiness: "ready" | "canonical_reload_required" | "stale_edit_draft";
  error: string | null;
  cards: CanopyCard[];
  boards: CanopyBoardSummary[];
  statuses: readonly CanopyStatus[];
  lastDispatchSummary: CanopyDispatchSummary | null;
  dispatching: boolean;
  query: string;
  searchOpen: boolean;
  priorityFilter: Set<CanopyPriority>;
  statusFilter: Set<CanopyStatus>;
  attentionFilter: Set<CanopyHealthKey>;
  donePeriod: "all" | "week";
  agentFilter: string;
  boardFilter: string;
  showArchived: boolean;
  layout: "comfortable" | "compact";
  viewMode: "board" | "list";
  emptyColumnMode: "show" | "collapse" | "hide";
  collapsedStatuses: Set<CanopyStatus>;
  expandedEmptyStatuses: Set<CanopyStatus>;
  lastRefreshAt: number | null;
  lastRefreshError: string | null;
  draftOpen: boolean;
  draftDiscardOpen: boolean;
  draftSaving: boolean;
  editingCardId: string | null;
  editingCardBase: CanopyCard | null;
  draftTitle: string;
  draftNotes: string;
  draftStatus: CanopyStatus;
  draftPriority: CanopyPriority;
  draftLabels: string;
  draftAgentId: string;
  draftSessionKey: string;
  draftTemplateId: CanopyTemplateId | "";
  draftCommentBody: string;
  detailCardId: string | null;
  detailTab: "overview" | "activity" | "session" | "details";
  detailCommentBody: string;
  detailCommentDrafts: Map<string, string>;
  busyCardIds: Set<string>;
  selectedCardIds: Set<string>;
  bulkDialog: CanopyBulkDialog | null;
  bulkSaving: boolean;
  bulkResult: { completed: number; total: number } | null;
  draggedCardId: string | null;
  dragOverStatus: CanopyStatus | null;
  dragBeforeCardId: string | null;
};
