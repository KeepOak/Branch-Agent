import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { asDateTimestampMs } from "branch/plugin-sdk/string-coerce-runtime";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { getCardAlerts, visibleCardAlerts } from "../../lib/canopy/card-alerts.ts";
import { isActiveCanopyCard } from "../../lib/canopy/card-state.ts";
import {
  getCanopyDependencyState,
  getCanopyLifecycle,
  getCanopyState,
  moveCanopyCard,
  type CanopyCard,
  type CanopyStatus,
} from "../../lib/canopy/index.ts";
import { matchesAgentScope } from "./agent-filter.ts";
import { matchesBoardFilter } from "./board-filter.ts";
import {
  getCardActionState,
  renderArchiveCardAction,
  renderCardMoveControl,
  renderDeleteCardAction,
  renderEditCardAction,
  renderOpenSessionCardAction,
  renderStartExecutionButton,
  renderStopCardAction,
} from "./view-card-actions.ts";
import {
  renderCardAlert,
  renderCardUpdatedTime,
  renderCardPriority,
  renderCardMeta,
  renderCardCounts,
  renderCardSession,
} from "./view-card-content.ts";
import { openCardDetails, canopyCardDetailDrawerId } from "./view-card-details.ts";
import { openCreateModal, canopyCardModalId } from "./view-card-modal.ts";
import { canMutate, formatStatusLabel, type CanopyProps } from "./view-helpers.ts";
import { closeCanopyPopoverOnAction, canopyPopoverRef } from "./view-popover.ts";
import { canopyScrollFadeRef } from "./view-scroll-fade.ts";
import { getSessionStatus } from "./view-session-status.ts";

function isCardActionTarget(event: Event): boolean {
  return event.target instanceof Element
    ? Boolean(event.target.closest("button, a, input, select, textarea, details"))
    : false;
}

type CanopyCardSurface = "page" | "widget" | "list";

function renderCard(props: CanopyProps, card: CanopyCard, surface: CanopyCardSurface) {
  const {
    state,
    busy,
    live,
    linkedSessionKey,
    sessionTarget,
    writable,
    showStartControls,
    archived,
  } = getCardActionState(props, card);
  const widget = surface === "widget";
  const dependencies = getCanopyDependencyState(card, state.cards);
  const lifecycle = getCanopyLifecycle(card, props.sessions, props.sessionResolution);
  const now = Date.now();
  const updatedAt = asDateTimestampMs(card.updatedAt);
  const sessionStatus = getSessionStatus(card, lifecycle, now);
  const alerts = visibleCardAlerts(
    getCardAlerts(card, lifecycle, dependencies, now),
    sessionStatus.visible || sessionStatus.state === "running" ? sessionStatus.state : undefined,
  );
  const startAction =
    !widget && showStartControls
      ? renderStartExecutionButton(props, card, null, "autonomous")
      : nothing;
  const editAction = !widget && writable && !archived ? renderEditCardAction(props, card) : nothing;
  const archiveAction =
    !widget && writable ? renderArchiveCardAction(props, card, busy, archived) : nothing;
  const detailAction = widget
    ? nothing
    : html`
        <button
          class="btn"
          type="button"
          aria-label=${t("canopy.viewDetails")}
          aria-haspopup="dialog"
          aria-expanded=${state.detailCardId === card.id ? "true" : "false"}
          aria-controls=${canopyCardDetailDrawerId}
          @click=${() => {
            openCardDetails(state, card);
            props.onRequestUpdate?.();
          }}
        >
          ${icons.eye}<span>${t("canopy.viewDetails")}</span>
        </button>
      `;
  const sessionAction = widget ? nothing : renderOpenSessionCardAction(props, sessionTarget);
  const stopAction =
    !widget && writable && linkedSessionKey && live
      ? renderStopCardAction(props, card, busy)
      : nothing;
  const moveAction =
    !archived && (writable || widget)
      ? renderCardMoveControl(props, card, busy || !writable, { wide: widget })
      : nothing;
  const deleteAction = !widget && writable ? renderDeleteCardAction(props, card, busy) : nothing;
  const selected = state.selectedCardIds.has(card.id);
  const alertDescriptionId = `canopy-card-alert-${surface}-${card.id}`;
  const selectable = !widget && writable && !archived;
  const selectionMode = selectable && state.selectedCardIds.size > 0;
  const toggleSelection = () => {
    if (!selectable || busy || state.dispatching) {
      return;
    }
    if (state.selectedCardIds.has(card.id)) {
      state.selectedCardIds.delete(card.id);
    } else {
      state.selectedCardIds.add(card.id);
    }
    props.onRequestUpdate?.();
  };
  const actionsMenu =
    !widget && (writable || linkedSessionKey)
      ? html`
          <div class="canopy-card__action-menu">
            <button
              type="button"
              class="canopy-card__menu-trigger"
              aria-label=${t("canopy.cardActions")}
              aria-haspopup="dialog"
              aria-expanded="false"
              popovertarget=${`canopy-card-menu-${card.id}`}
            >
              ${icons.moreHorizontal}
            </button>
            <div
              id=${`canopy-card-menu-${card.id}`}
              popover="auto"
              role="dialog"
              aria-label=${t("canopy.cardActions")}
              class="canopy-card__action-menu-panel"
              ${ref(canopyPopoverRef("end"))}
              @click=${closeCanopyPopoverOnAction}
            >
              <div class="canopy-card__menu-group">${detailAction} ${editAction}</div>
              ${
                startAction !== nothing || sessionAction !== nothing || stopAction !== nothing
                  ? html`<div class="canopy-card__menu-group">
                      ${startAction} ${sessionAction} ${stopAction}
                    </div>`
                  : nothing
              }
              ${
                moveAction === nothing
                  ? nothing
                  : html`
                      <div class="canopy-card__menu-status">
                        <span>${t("canopy.moveTo")}</span>
                        ${moveAction}
                      </div>
                    `
              }
              ${
                archiveAction !== nothing || deleteAction !== nothing
                  ? html`<div class="canopy-card__menu-group">
                      ${archiveAction} ${deleteAction}
                    </div>`
                  : nothing
              }
            </div>
          </div>
        `
      : nothing;
  const updatedTime = renderCardUpdatedTime(updatedAt, now);
  const priority = renderCardPriority(card);
  const listContents =
    surface === "list"
      ? html`
          <div class="canopy-list-row__priority">${priority}</div>
          <div class="canopy-list-row__identity">
            <div class="canopy-list-row__title">
              <h3
                class="canopy-truncate"
                title=${[card.title, card.notes].filter(Boolean).join("\n\n")}
              >
                ${card.title}
              </h3>
              ${
                card.labels.length
                  ? html`<div class="canopy-card__labels">
                      ${card.labels
                        .slice(0, 1)
                        .map(
                          (label) =>
                            html`<span class="canopy-chip canopy-truncate" title=${label}
                              >${label}</span
                            >`,
                        )}
                      ${
                        card.labels.length > 1
                          ? html`<span
                              class="canopy-chip"
                              title=${card.labels.slice(1).join(", ")}
                              aria-label=${t("canopy.cardMoreLabels", {
                                count: String(card.labels.length - 1),
                                labels: card.labels.slice(1).join(", "),
                              })}
                              >+${card.labels.length - 1}</span
                            >`
                          : nothing
                      }
                    </div>`
                  : nothing
              }
              ${
                archived
                  ? html`<span class="canopy-card__archived">${t("canopy.archived")}</span>`
                  : nothing
              }
            </div>
            <div class="canopy-list-row__context">
              ${
                alerts.length
                  ? html`<div class="canopy-list-row__alert">
                      ${renderCardAlert(alerts, alertDescriptionId)}
                    </div>`
                  : nothing
              }
              ${renderCardCounts(card)}
            </div>
          </div>
          <div class="canopy-list-row__session">
            ${renderCardSession(props, card, lifecycle, sessionStatus)}
          </div>
          <div class="canopy-list-row__updated">${updatedTime}</div>
          <div class="canopy-list-row__actions">${actionsMenu}</div>
        `
      : nothing;
  return html`
    <article
      class="canopy-card ${
        surface === "list" ? "canopy-card--list" : ""
      } priority-${card.priority} ${busy ? "canopy-card--busy" : ""} ${
        archived ? "canopy-card--archived" : ""
      }
      ${state.draggedCardId === card.id ? "canopy-card--dragging" : ""} ${
        selected ? "canopy-card--selected" : ""
      } ${widget ? "canopy-card--widget" : "canopy-card--openable"}"
      role=${widget ? nothing : "button"}
      tabindex=${widget ? nothing : "0"}
      aria-pressed=${selectionMode ? String(selected) : nothing}
      aria-describedby=${alerts.length ? alertDescriptionId : nothing}
      aria-keyshortcuts=${selectable ? "Shift+Enter Shift+Space" : nothing}
      title=${
        widget || !selectionMode
          ? nothing
          : t(selected ? "canopy.deselectCard" : "canopy.selectCard", { title: card.title })
      }
      aria-haspopup=${widget || selectionMode ? nothing : "dialog"}
      aria-expanded=${
        widget || selectionMode ? nothing : state.detailCardId === card.id ? "true" : "false"
      }
      aria-controls=${widget || selectionMode ? nothing : canopyCardDetailDrawerId}
      draggable=${writable && !archived && !state.dispatching ? "true" : "false"}
      @mousedown=${(event: MouseEvent) => {
        if (event.button === 0 && event.shiftKey && selectable && !isCardActionTarget(event)) {
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }
      }}
      @click=${(event: MouseEvent) => {
        if (!widget && !isCardActionTarget(event)) {
          if (selectionMode || (event.shiftKey && selectable)) {
            toggleSelection();
            return;
          }
          openCardDetails(state, card);
          props.onRequestUpdate?.();
        }
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (widget || isCardActionTarget(event) || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        if (selectionMode || (event.shiftKey && selectable)) {
          toggleSelection();
        } else {
          openCardDetails(state, card);
          props.onRequestUpdate?.();
        }
        event.preventDefault();
      }}
      @dragstart=${(event: DragEvent) => {
        if (!writable || archived || state.dispatching) {
          event.preventDefault();
          return;
        }
        state.draggedCardId = card.id;
        state.dragOverStatus = null;
        state.dragBeforeCardId = null;
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", card.id);
          const source = event.currentTarget;
          if (!(source instanceof HTMLElement)) {
            return;
          }
          const bounds = source.getBoundingClientRect();
          event.dataTransfer.setDragImage(
            source,
            event.clientX - bounds.left,
            event.clientY - bounds.top,
          );
        }
        props.onRequestUpdate?.();
      }}
      @dragend=${() => {
        state.draggedCardId = null;
        state.dragOverStatus = null;
        state.dragBeforeCardId = null;
        props.onRequestUpdate?.();
      }}
    >
      ${
        surface === "list"
          ? listContents
          : html` <header class="canopy-card__title">
                <h3 class="canopy-truncate-two" title=${card.title}>${card.title}</h3>
                <div class="canopy-card__header-actions">${actionsMenu}</div>
              </header>
              ${renderCardSession(props, card, lifecycle, sessionStatus)}
              ${renderCardMeta(card, archived)} ${renderCardAlert(alerts, alertDescriptionId)}
              ${renderCardCounts(card)}
              <footer class="canopy-card__footer">${priority} ${updatedTime}</footer>
              ${
                widget
                  ? html`<div class="canopy-card__actions canopy-card__actions--widget">
                      ${moveAction}
                    </div>`
                  : nothing
              }`
      }
    </article>
  `;
}

function dropBeforeCardId(event: DragEvent, draggedCardId: string | null): string | null {
  const column = event.currentTarget;
  if (!(column instanceof HTMLElement)) {
    return null;
  }
  const items = column.querySelectorAll<HTMLElement>(".canopy-column__item");
  for (const item of items) {
    if (item.dataset.cardId === draggedCardId) {
      continue;
    }
    const bounds = item.getBoundingClientRect();
    if (event.clientY < bounds.top + bounds.height / 2) {
      return item.dataset.cardId ?? null;
    }
  }
  return null;
}

export function renderColumn(
  props: CanopyProps,
  status: CanopyStatus,
  cards: CanopyCard[],
  options: { surface?: CanopyCardSurface; boardFilter?: string } = {},
) {
  const state = getCanopyState(props.host);
  const writable = canMutate(props);
  const surface = options.surface ?? "page";
  const collapsible = surface !== "widget";
  const canCreate = surface !== "widget" && writable;
  const label = formatStatusLabel(status);
  const hasHiddenCards =
    cards.length === 0 &&
    state.cards.some(
      (card) =>
        card.status === status &&
        (state.showArchived || isActiveCanopyCard(card)) &&
        matchesBoardFilter(card, options.boardFilter ?? state.boardFilter) &&
        matchesAgentScope(
          card,
          props.agentsList?.defaultId ?? props.defaultAgentId,
          props.scopeAgentId,
        ),
    );
  const columnMenuId = `canopy-column-menu-${status}`;
  const selectableCards = cards.filter(
    (card) => isActiveCanopyCard(card) && !state.busyCardIds.has(card.id),
  );
  const closeColumnMenu = (event: MouseEvent) => {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
    }
  };
  const renderCreateButton = (className: string, withLabel = false) => html`
    <button
      class=${className}
      type="button"
      title=${withLabel ? nothing : t("canopy.newCardInColumn", { column: label })}
      aria-label=${t("canopy.newCardInColumn", { column: label })}
      aria-haspopup="dialog"
      aria-expanded=${state.draftOpen ? "true" : "false"}
      aria-controls=${canopyCardModalId}
      ?disabled=${state.dispatching}
      @click=${() => {
        openCreateModal(state, props, status);
        props.onRequestUpdate?.();
      }}
    >
      <span aria-hidden="true">${icons.plus}</span>
      ${withLabel ? html`<span>${t("canopy.newCard")}</span>` : nothing}
    </button>
  `;
  const autoCollapsed =
    state.emptyColumnMode === "collapse" &&
    cards.length === 0 &&
    !state.expandedEmptyStatuses.has(status);
  const collapsed = collapsible && (state.collapsedStatuses.has(status) || autoCollapsed);
  const dropTarget = Boolean(state.draggedCardId && state.dragOverStatus === status);
  const lastDropCardId = cards.findLast((card) => card.id !== state.draggedCardId)?.id;
  const restoreToggleFocus = (event: MouseEvent) => {
    if (event.detail !== 0) {
      return;
    }
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    const column = event.currentTarget.closest(".canopy-column");
    // The toggle is replaced on collapse; keep keyboard focus on its replacement.
    queueMicrotask(() => {
      column
        ?.querySelector<HTMLButtonElement>(
          ".canopy-column__rail, .canopy-column__collapse, .canopy-list-group__toggle",
        )
        ?.focus({ preventScroll: true });
    });
  };
  const expandColumn = (event: MouseEvent) => {
    state.collapsedStatuses.delete(status);
    if (cards.length === 0) {
      state.expandedEmptyStatuses.add(status);
    }
    props.onRequestUpdate?.();
    restoreToggleFocus(event);
  };
  const collapseColumn = (event: MouseEvent) => {
    state.collapsedStatuses.add(status);
    state.expandedEmptyStatuses.delete(status);
    props.onRequestUpdate?.();
    restoreToggleFocus(event);
  };
  return html`
    <section
      class="canopy-column canopy-column--${status} ${
        state.draggedCardId && state.dragOverStatus === status
          ? "canopy-column--drop-target"
          : ""
      } ${collapsed ? "canopy-column--collapsed" : ""}"
      aria-label=${`${label}, ${cards.length}`}
      @dragover=${(event: DragEvent) => {
        if (writable && state.draggedCardId) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          const beforeCardId = dropBeforeCardId(event, state.draggedCardId);
          if (state.dragOverStatus !== status || state.dragBeforeCardId !== beforeCardId) {
            state.dragOverStatus = status;
            state.dragBeforeCardId = beforeCardId;
            props.onRequestUpdate?.();
          }
        }
      }}
      @dragleave=${(event: DragEvent) => {
        const column = event.currentTarget;
        if (!(column instanceof HTMLElement)) {
          return;
        }
        // Moving between cards in the same column keeps that destination active.
        if (event.relatedTarget instanceof Node && column.contains(event.relatedTarget)) {
          return;
        }
        if (state.dragOverStatus === status) {
          state.dragOverStatus = null;
          state.dragBeforeCardId = null;
          props.onRequestUpdate?.();
        }
      }}
      @drop=${(event: DragEvent) => {
        event.preventDefault();
        const cardId = event.dataTransfer?.getData("text/plain") || state.draggedCardId;
        const beforeCardId = dropBeforeCardId(event, cardId);
        state.draggedCardId = null;
        state.dragOverStatus = null;
        state.dragBeforeCardId = null;
        props.onRequestUpdate?.();
        if (!writable) {
          return;
        }
        const card = state.cards.find((candidate) => candidate.id === cardId);
        if (!card || !isActiveCanopyCard(card)) {
          return;
        }
        void moveCanopyCard({
          host: props.host,
          client: props.client,
          cardId: card.id,
          status,
          beforeCardId,
          boardFilter: options.boardFilter ?? state.boardFilter,
          requestUpdate: props.onRequestUpdate,
        });
      }}
    >
      ${
        collapsed && surface !== "list"
          ? html`
              <button
                class="canopy-column__rail"
                type="button"
                aria-label=${t("canopy.expandColumn", { column: label })}
                aria-expanded="false"
                @click=${expandColumn}
              >
                <span class="canopy-column__rail-title">${label}</span>
                <span class="canopy-column__count">${cards.length}</span>
                <span class="canopy-column__rail-icon" aria-hidden="true">
                  <span class="canopy-column__direction-icon">${icons.maximize}</span>
                </span>
              </button>
            `
          : html`
              <div class="canopy-column__header">
                <div class="canopy-column__heading">
                  ${
                    surface === "list"
                      ? html`<h2>
                          <button
                            class="canopy-list-group__toggle"
                            type="button"
                            aria-expanded=${!collapsed}
                            aria-controls=${`canopy-column-cards-${status}`}
                            @click=${collapsed ? expandColumn : collapseColumn}
                          >
                            <span class="canopy-list-group__chevron" aria-hidden="true">
                              ${collapsed ? icons.chevronRight : icons.chevronDown}
                            </span>
                            <span class="canopy-list-group__label">${label}</span>
                            <span class="canopy-column__count">${cards.length}</span>
                          </button>
                        </h2>`
                      : html`<h2>${label}</h2>
                          <span class="canopy-column__count">${cards.length}</span>`
                  }
                </div>
                ${
                  collapsible
                    ? html`<div class="canopy-column__header-actions">
                        ${
                          surface !== "list"
                            ? html`<button
                                class="canopy-column__control canopy-column__collapse"
                                type="button"
                                aria-label=${t("canopy.collapseColumn", { column: label })}
                                title=${t("canopy.collapseColumn", { column: label })}
                                aria-expanded="true"
                                @click=${collapseColumn}
                              >
                                <span class="canopy-column__direction-icon" aria-hidden="true"
                                  >${icons.minimize}</span
                                >
                              </button>`
                            : nothing
                        }
                        ${
                          writable
                            ? html`<div class="canopy-column__menu">
                                <button
                                  class="canopy-column__control"
                                  type="button"
                                  popovertarget=${columnMenuId}
                                  aria-label=${t("canopy.columnActions", { column: label })}
                                  title=${t("canopy.columnActions", { column: label })}
                                  aria-expanded="false"
                                >
                                  ${icons.moreHorizontal}
                                </button>
                                <div
                                  class="canopy-column__popover"
                                  id=${columnMenuId}
                                  popover="auto"
                                  role="group"
                                  aria-label=${t("canopy.columnActions", { column: label })}
                                  ${ref(canopyPopoverRef("end"))}
                                >
                                  <button
                                    type="button"
                                    ?disabled=${!selectableCards.length || state.dispatching}
                                    @click=${(event: MouseEvent) => {
                                      closeColumnMenu(event);
                                      for (const card of selectableCards) {
                                        state.selectedCardIds.add(card.id);
                                      }
                                      props.onRequestUpdate?.();
                                    }}
                                  >
                                    ${t("canopy.selectAllInColumn", { column: label })}
                                  </button>
                                </div>
                              </div>`
                            : nothing
                        }
                        ${canCreate ? renderCreateButton("canopy-column__control") : nothing}
                      </div>`
                    : nothing
                }
              </div>
              ${
                collapsed
                  ? html`<div id=${`canopy-column-cards-${status}`} hidden></div>`
                  : html`<div
                      class="canopy-column__cards"
                      id=${surface === "list" ? `canopy-column-cards-${status}` : nothing}
                      role=${surface === "list" ? "list" : nothing}
                      ${ref(canopyScrollFadeRef())}
                    >
                      ${
                        cards.length
                          ? cards.map(
                              (card) => html`
                                <div
                                  class="canopy-column__item ${
                                    dropTarget && state.dragBeforeCardId === card.id
                                      ? "canopy-column__item--drop-before"
                                      : ""
                                  } ${
                                    dropTarget &&
                                    state.dragBeforeCardId === null &&
                                    card.id === lastDropCardId
                                      ? "canopy-column__item--drop-after"
                                      : ""
                                  }"
                                  role=${surface === "list" ? "listitem" : nothing}
                                  data-card-id=${card.id}
                                >
                                  ${renderCard(props, card, surface)}
                                </div>
                              `,
                            )
                          : state.draggedCardId
                            ? html`<div class="canopy-empty">${t("canopy.emptyColumn")}</div>`
                            : !hasHiddenCards && canCreate
                              ? renderCreateButton(
                                  "canopy-column__add canopy-column__add--empty",
                                  true,
                                )
                              : html`<div class="canopy-column__empty">
                                  <span
                                    >${t(
                                      hasHiddenCards
                                        ? "canopy.emptyFilteredTitle"
                                        : "canopy.emptyColumnTitle",
                                    )}</span
                                  >
                                  ${
                                    hasHiddenCards
                                      ? html`<span>${t("canopy.emptyFilteredHint")}</span>`
                                      : nothing
                                  }
                                </div>`
                      }
                      ${
                        canCreate && !state.draggedCardId && cards.length > 0 && surface !== "list"
                          ? renderCreateButton("canopy-column__add", true)
                          : nothing
                      }
                    </div>`
              }
            `
      }
    </section>
  `;
}
