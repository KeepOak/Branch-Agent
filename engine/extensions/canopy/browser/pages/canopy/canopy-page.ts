import { html, nothing, render } from "lit";
import type { ControlUiView } from "branch/plugin-sdk/control-ui";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { renderAgentPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyBoardGlyph } from "../../components/canopy-board-glyph.ts";
import { t } from "../../i18n/index.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { canopyCardBoardId } from "../../lib/canopy/board-filter.ts";
import { canopyBoardName } from "../../lib/canopy/board-presentation.ts";
import type { CanopyCapability } from "../../lib/canopy/capability.ts";
import { canopyCardSessionKey } from "../../lib/canopy/card-state.ts";
import {
  configureCanopyLiveRefresh,
  handleCanopyChanged,
  loadCanopy,
  refreshCanopy,
  resetDraftState,
  resumeCanopyLiveRefresh,
  resetCanopyConnectionState,
  stopCanopyLiveRefresh,
  type CanopyCard,
  type CanopyUiState,
  CANOPY_CHANGED_EVENT,
} from "../../lib/canopy/index.ts";
import { invalidateCanopyLoads } from "../../lib/canopy/runtime.ts";
import { createCanopySessionResolver } from "../../lib/canopy/session-resolution.ts";
import type { CanopyBoardMetadata } from "../../lib/canopy/types.ts";
import { matchesAgentScope } from "./agent-filter.ts";
import { matchesBoardFilter, CANOPY_ALL_BOARDS_FILTER } from "./board-filter.ts";
import { createSessionsBoardController } from "./sessions-board-controller.ts";
import { loadBoardAutomation, renderBoardAutomationHeading } from "./view-automation.ts";
import {
  createBoardDraft,
  createNewBoardDraft,
  renderBoardModal,
  type BoardDraft,
} from "./view-board-modal.ts";
import { getVisibleDetailCard } from "./view-card-details.ts";
import {
  canopyErrorMessage,
  type BoardAutomationState,
  type CanopyProps,
} from "./view-helpers.ts";
import { renderSessionsBoard } from "./view-sessions-board.ts";
import { renderCanopy } from "./view.ts";

export function canopyPageTarget(boardId?: string) {
  return {
    id: "canopy",
    path: boardId && boardId !== CANOPY_ALL_BOARDS_FILTER ? [boardId] : [],
  };
}

function reconcileCardOverlays(state: CanopyUiState, visible: (card: CanopyCard) => boolean) {
  const remainsVisible = (id: string) =>
    state.cards.some((card) => card.id === id && visible(card));
  if (state.detailCardId && !remainsVisible(state.detailCardId)) {
    state.detailCardId = null;
    state.detailCommentBody = "";
  }
  // Preserve submitted input for retry if the pending save fails.
  if (!state.draftSaving && state.editingCardId && !remainsVisible(state.editingCardId)) {
    resetDraftState(state);
  }
}

export function createCanopyPage(
  canopy: CanopyCapability,
  registerBoardNavigation: (board: CanopyBoardMetadata) => void,
): ControlUiView {
  return (container, initialContext) => {
    const host = initialContext.host;
    let context = initialContext;
    let disposed = false;
    let boardDraft: BoardDraft | null = null;
    const automations = new Map<string, BoardAutomationState>();
    let queued = false;
    let connected = false;
    let refreshActive = false;
    let metadataGeneration = 0;
    let metadataLoad: Promise<void> | null = null;
    // Card reloads cannot clear an unresolved agent/session metadata failure.
    let metadataError: string | null = null;
    let observedScope: string | null | undefined;
    let redirectedBoard = "";
    const client = host;
    const state = canopy.state;
    const requestUpdate = () => {
      if (disposed || queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!disposed) {
          update();
        }
      });
    };
    const sessionResolver = createCanopySessionResolver(host, requestUpdate);
    const sessionsBoard = createSessionsBoardController(host, requestUpdate);
    const stop = () => {
      // A paused page no longer owns shared loads started by session actions.
      if (!refreshActive) {
        return;
      }
      refreshActive = false;
      stopCanopyLiveRefresh(canopy);
      resetCanopyConnectionState(canopy);
    };
    const refreshMetadata = () => {
      if (disposed || !connected) {
        return Promise.resolve();
      }
      if (metadataLoad) {
        return metadataLoad;
      }
      const generation = metadataGeneration;
      const load = host.agents
        .refresh()
        .then(() => {
          if (disposed || generation !== metadataGeneration) {
            return;
          }
          metadataError = null;
          requestUpdate();
        })
        .catch((error: unknown) => {
          if (disposed || generation !== metadataGeneration) {
            return;
          }
          metadataError = formatUiError(error);
          requestUpdate();
        })
        .finally(() => {
          if (metadataLoad === load) {
            metadataLoad = null;
          }
        });
      metadataLoad = load;
      return load;
    };
    const synchronizeConnection = () => {
      const nextConnected = host.connection.connected;
      if (connected === nextConnected) {
        return;
      }
      connected = nextConnected;
      metadataGeneration += 1;
      metadataLoad = null;
      if (connected) {
        void refreshMetadata();
      } else {
        stop();
      }
    };
    const update = () => {
      synchronizeConnection();
      const agents = host.agents.rows;
      const selectableAgents = agents.filter((agent) => agent.kind !== "system");
      const defaultId = host.agents.defaultId;
      const defaultAgentId = defaultId ?? host.connection.assistantAgentId;
      const agentsList = defaultId === null ? null : { defaultId, agents: [...agents] };
      const boardId =
        context.props.boardId || context.props.boardFilter || CANOPY_ALL_BOARDS_FILTER;
      const scope = host.agents.scopeId;
      const missingScope =
        scope && !selectableAgents.some((agent) => agent.id === scope) ? scope : null;
      if (observedScope !== scope) {
        observedScope = scope;
        state.agentFilter = "all";
        reconcileCardOverlays(state, (card) => matchesAgentScope(card, defaultAgentId, scope));
      }
      if (state.boardFilter !== boardId) {
        if (state.boards.find((board) => board.id === state.boardFilter)?.kind === "sessions") {
          state.loaded = false;
          state.loadAttempted = false;
        }
        state.boardFilter = boardId;
        reconcileCardOverlays(state, (card) => matchesBoardFilter(card, boardId));
      }
      if (
        context.presented &&
        boardId !== CANOPY_ALL_BOARDS_FILTER &&
        canopy.boardsReady &&
        !state.boards.some((board) => board.id === boardId)
      ) {
        if (redirectedBoard !== boardId) {
          redirectedBoard = boardId;
          host.navigation.openPage(canopyPageTarget(), {
            replace: true,
            preserveSearch: true,
          });
        }
      } else {
        redirectedBoard = "";
      }
      const selectedBoard =
        boardId === CANOPY_ALL_BOARDS_FILTER
          ? null
          : state.boards.find((board) => board.id === boardId);
      sessionsBoard.sync(selectedBoard, connected && context.presented);
      if (connected && context.presented) {
        refreshActive = true;
        const force = configureCanopyLiveRefresh({
          host: canopy,
          client,
          requestUpdate,
          shouldDefer: () => Boolean(boardDraft || sessionsBoard.busy || sessionsBoard.draggedKey),
          refresh: selectedBoard?.kind === "sessions" ? sessionsBoard.read : undefined,
        });
        void loadCanopy({
          host: canopy,
          client,
          requestUpdate,
          force,
          refreshDiagnostics: host.connection.canWrite && selectedBoard?.kind !== "sessions",
        });
        resumeCanopyLiveRefresh(canopy);
      } else {
        stop();
      }
      const detailCard = getVisibleDetailCard(state);
      const detailJobId = detailCard
        ? state.boards.find((board) => board.id === canopyCardBoardId(detailCard))
            ?.automationJobId
        : undefined;
      const activeJobIds = new Set(
        connected && context.presented
          ? [selectedBoard?.automationJobId, detailJobId].filter((id) => typeof id === "string")
          : [],
      );
      for (const jobId of automations.keys()) {
        if (!activeJobIds.has(jobId)) {
          automations.delete(jobId);
        }
      }
      for (const jobId of activeJobIds) {
        if (automations.has(jobId)) {
          continue;
        }
        const pending: BoardAutomationState = { jobId, status: "loading" };
        automations.set(jobId, pending);
        void loadBoardAutomation(client, jobId).then((automation) => {
          if (disposed || automations.get(jobId) !== pending) {
            return;
          }
          automations.set(jobId, automation);
          requestUpdate();
        });
      }
      const focusedCard = state.draftOpen
        ? state.cards.find((card) => card.id === state.editingCardId)
        : getVisibleDetailCard(state);
      sessionResolver.sync(
        focusedCard ? canopyCardSessionKey(focusedCard) : undefined,
        connected && context.presented,
      );
      const sessionResolution = sessionResolver.resolution;
      const sessionError =
        sessionResolution && sessionResolution.status !== "resolved"
          ? sessionResolution.error
          : undefined;
      const pageError = [metadataError, sessionError].filter(Boolean).join("\n") || undefined;
      const candidates =
        sessionResolution?.status === "resolved"
          ? [sessionResolution.session]
          : (sessionResolution?.candidates ?? []);
      const sessions = [
        ...new Map(
          [...host.sessions.rows, ...candidates].map((session) => [session.key, session]),
        ).values(),
      ];
      const onNewBoard = () => {
        boardDraft = createNewBoardDraft();
        requestUpdate();
      };
      const onBoardChange = (boardFilter: string) =>
        host.navigation.openPage(canopyPageTarget(boardFilter), {
          replace: true,
          preserveSearch: true,
        });
      const renderBoard = (props: CanopyProps & { onRefresh: () => void }) =>
        selectedBoard?.kind === "sessions"
          ? renderSessionsBoard({
              board: selectedBoard,
              boards: state.boards,
              controller: sessionsBoard,
              host,
              heading: props.heading ?? html``,
              scopeControl: props.scopeControl,
              pageError,
              overlayOpen: Boolean(boardDraft),
              onNewBoard,
              onBoardChange,
            })
          : renderCanopy(props);
      render(
        html`
          ${renderBoard({
            heading: html`
              <div class="canopy-heading__identity">
                <div class="page-title canopy-page-title">
                  ${
                    selectedBoard
                      ? renderCanopyBoardGlyph(selectedBoard, "canopy-board-glyph--header")
                      : nothing
                  }
                  <span>${selectedBoard ? canopyBoardName(selectedBoard) : "Canopy"}</span>
                  ${
                    selectedBoard && host.connection.canWrite
                      ? html`
                          <button
                            class="btn btn--icon canopy-board-edit"
                            type="button"
                            aria-label=${t("canopy.editBoard")}
                            title=${t("canopy.editBoard")}
                            @click=${() => {
                              boardDraft = createBoardDraft({
                                ...selectedBoard,
                                ...(sessionsBoard.snapshot?.board.id === selectedBoard.id
                                  ? sessionsBoard.snapshot.board
                                  : {}),
                              });
                              requestUpdate();
                            }}
                          >
                            ${icons.penLine}
                          </button>
                        `
                      : nothing
                  }
                </div>
                ${
                  selectedBoard?.automationJobId
                    ? renderBoardAutomationHeading(automations.get(selectedBoard.automationJobId))
                    : nothing
                }
              </div>
            `,
            scopeControl:
              selectableAgents.length > 1 || scope
                ? renderAgentPicker(
                    {
                      options: [
                        { value: "", label: t("canopy.allAgents"), icon: "users" },
                        ...selectableAgents.map((agent) => ({
                          value: agent.id,
                          label: agent.name ?? agent.identity?.name ?? agent.id,
                          agent,
                        })),
                        ...(missingScope
                          ? [
                              {
                                value: missingScope,
                                label: missingScope,
                                agent: { id: missingScope },
                              },
                            ]
                          : []),
                      ],
                      value: scope ?? "",
                      variant: "compact",
                      accessibleLabel: t("canopy.agentFilter"),
                      onSelect: (value) => host.agents.setScope(value || null),
                    },
                    "canopy-scope",
                  )
                : undefined,
            pageError,
            overlayOpen: Boolean(boardDraft),
            presented: context.presented,
            detailBoardAutomation: detailJobId ? automations.get(detailJobId) : undefined,
            host: canopy,
            client: connected ? client : null,
            connected,
            canWrite: host.connection.canWrite,
            canGrant: host.connection.canGrant,
            canModelOverride: host.connection.canAdmin,
            agentsList,
            defaultAgentId,
            sessions,
            sessionResolution,
            scopeAgentId: scope,
            onClearAgentScope: () => host.agents.setScope(null),
            showAgentFilter: false,
            onOpenSession: host.sessions.open,
            onRefresh: () => {
              automations.clear();
              void refreshMetadata();
              sessionResolver.refresh();
              void refreshCanopy({
                host: canopy,
                client: connected ? client : null,
                requestUpdate,
                source: "manual",
                refreshDiagnostics: host.connection.canWrite,
              });
            },
            onBoardFilterChange: onBoardChange,
            onNewBoard,
            onRequestUpdate: requestUpdate,
          })}
          ${
            boardDraft
              ? renderBoardModal({
                  draft: boardDraft,
                  toastOwner: state,
                  pageError: canopyErrorMessage(state, pageError),
                  client: connected ? client : null,
                  get canWrite() {
                    const connection = host.connection;
                    return connection.connected && connection.canWrite;
                  },
                  requestUpdate,
                  onCancel: () => {
                    boardDraft = null;
                    requestUpdate();
                  },
                  onSaved: (board) => {
                    if (disposed) {
                      return;
                    }
                    const creating = boardDraft?.create;
                    boardDraft = null;
                    if (creating) {
                      invalidateCanopyLoads(canopy);
                      registerBoardNavigation(board);
                      host.ui.pinNavigation(`board-${board.id}`);
                    }
                    void refreshCanopy({
                      host: canopy,
                      client,
                      requestUpdate,
                      source: "manual",
                    }).then(() => {
                      if (disposed) {
                        return;
                      }
                      if (creating) {
                        onBoardChange(board.id);
                      } else if (selectedBoard?.kind === "sessions") {
                        void sessionsBoard.read();
                      }
                    });
                    requestUpdate();
                  },
                })
              : nothing
          }
        `,
        container,
      );
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeCanopyLiveRefresh(canopy);
      }
    };
    const unsubscribeHost = host.subscribe(() => {
      if (disposed) {
        return;
      }
      synchronizeConnection();
      requestUpdate();
    });
    const unsubscribeState = canopy.subscribe(requestUpdate);
    const unsubscribeEvents = host.onEvent(CANOPY_CHANGED_EVENT, (payload) => {
      if (!disposed && connected && context.presented) {
        handleCanopyChanged(canopy, payload);
      }
    });
    const unsubscribeCron = host.onEvent("cron", (payload) => {
      if (
        !disposed &&
        connected &&
        context.presented &&
        isRecord(payload) &&
        typeof payload.jobId === "string" &&
        automations.delete(payload.jobId)
      ) {
        requestUpdate();
      }
    });
    document.addEventListener("visibilitychange", onVisibilityChange);
    update();
    return {
      update(next) {
        context = next;
        requestUpdate();
      },
      dispose() {
        disposed = true;
        metadataGeneration += 1;
        unsubscribeHost();
        unsubscribeState();
        unsubscribeEvents();
        unsubscribeCron();
        sessionsBoard.dispose();
        sessionResolver.dispose();
        document.removeEventListener("visibilitychange", onVisibilityChange);
        stop();
        render(nothing, container);
      },
    };
  };
}
