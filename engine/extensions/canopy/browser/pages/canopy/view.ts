import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { renderSelectPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyToast } from "../../components/toast.ts";
import { t } from "../../i18n/index.ts";
import { listSelectableAgents } from "../../lib/agents/display.ts";
import "../../styles/canopy.css";
import {
  dispatchCanopy,
  filterCanopyCards,
  canopyCardMatchesHealthKey,
  getCanopyState,
  canopyHasActiveWrites,
  CANOPY_PRIORITIES,
  type CanopyCard,
  type CanopyStatus,
} from "../../lib/canopy/index.ts";
import {
  agentDisplayName,
  buildAgentFilterOptions,
  normalizeActiveAgentFilter,
} from "./agent-filter.ts";
import { buildBoardFilterOptions, CANOPY_ALL_BOARDS_FILTER } from "./board-filter.ts";
import { getVisibleDetailCard, renderCardDetailsPanel } from "./view-card-details.ts";
import { openCreateModal, renderCardModal, canopyCardModalId } from "./view-card-modal.ts";
import { renderColumn } from "./view-card.ts";
import {
  multiFilterLabel,
  renderActiveFilters,
  renderStatusTabs,
  renderMobileStatusPicker,
  renderFilterSelect,
  renderFilterChoices,
  renderMultiFilter,
  type ActiveFilter,
} from "./view-filter-controls.ts";
import {
  canMutate,
  formatPriorityLabel,
  canopyErrorMessage,
  renderPriorityIcon,
  dispatchSummaryMessage,
  refreshStatusLabel,
  matchesCardQuery,
  type CanopyProps,
} from "./view-helpers.ts";
import { canopyPopoverRef } from "./view-popover.ts";
import { boardScrollEdgesRef } from "./view-scroll-fade.ts";
import {
  matchesCanopyCardScope,
  reconcileSelectionScope,
  renderSelectionActions,
  renderSelectionDialog,
} from "./view-selection.ts";
import type { CanopySelectOption } from "./canopy-select.ts";

const canopyFilterPopoverId = "canopy-filter-popover";

export function renderCanopy(props: CanopyProps & { onRefresh: () => void }) {
  const state = getCanopyState(props.host);
  const agentOptions = buildAgentFilterOptions(props.agentsList, state.cards);
  state.agentFilter = normalizeActiveAgentFilter(agentOptions, state.agentFilter);
  reconcileSelectionScope(props);
  const boardOptions = buildBoardFilterOptions(state.boards, state.cards);
  // A valid route can outlive a deleted board. Keep that id as the active
  // filter so the page becomes empty instead of silently showing every card.
  const activeBoardFilter = state.boardFilter;
  const scopedCards = state.cards
    .filter((card) => state.showArchived || !card.metadata?.archivedAt)
    .filter((card) => matchesCanopyCardScope(props, card))
    .filter((card) => matchesCardQuery(card, state.query));
  const now = Date.now();
  const cardsForFilters = (ignore?: "status" | "priority" | "attention") =>
    filterCanopyCards({
      cards: scopedCards,
      filters: state,
      sessions: props.sessions,
      now,
      ignore,
    });
  const filtered = cardsForFilters();
  const visibleError = canopyErrorMessage(state, props.pageError);
  const writable = canMutate(props);
  const selectedCards = state.cards.filter((card) => state.selectedCardIds.has(card.id));
  const byStatus = new Map<CanopyStatus, CanopyCard[]>();
  for (const status of state.statuses) {
    byStatus.set(status, []);
  }
  for (const card of filtered) {
    byStatus.get(card.status)?.push(card);
  }
  const visibleStatuses = state.statuses.filter(
    (status) =>
      (!state.statusFilter.size || state.statusFilter.has(status)) &&
      (state.emptyColumnMode !== "hide" || (byStatus.get(status)?.length ?? 0) > 0),
  );
  // Counts ignore their own group, so selecting one option does not erase alternatives.
  const priorityCards = cardsForFilters("priority");
  const priorityOptions = CANOPY_PRIORITIES.map((priority) => ({
    value: priority,
    label: formatPriorityLabel(priority),
    icon: renderPriorityIcon(priority),
    count: priorityCards.filter((card) => card.priority === priority).length,
  }));
  const attentionCards = cardsForFilters("attention");
  const attentionOptions = (["stale", "missingProof"] as const).map((key) => ({
    value: key,
    label: t(key === "stale" ? "canopy.filterStale" : "canopy.filterMissingProof"),
    title: t(key === "stale" ? "canopy.filterStaleHint" : "canopy.filterMissingProofHint"),
    count: attentionCards.filter((card) => canopyCardMatchesHealthKey(card, key, props.sessions))
      .length,
  }));
  const clearFilters = () => {
    state.query = "";
    state.searchOpen = false;
    state.statusFilter.clear();
    state.priorityFilter.clear();
    state.attentionFilter.clear();
    state.donePeriod = "all";
    state.showArchived = false;
    props.onRequestUpdate?.();
  };
  const agentFilterOptions: CanopySelectOption[] = agentOptions.map((option) => ({
    value: option.id,
    label: option.label,
    description: option.description,
    icon: option.id === "all" ? "users" : option.id === "default" ? "bot" : undefined,
  }));
  const activeFilters: ActiveFilter[] = [];
  if (state.query.trim()) {
    activeFilters.push({
      id: "query",
      label: t("canopy.filterChipSearch", { query: state.query.trim() }),
      clear: () => {
        state.query = "";
      },
    });
  }
  if (state.priorityFilter.size) {
    activeFilters.push({
      id: "priority",
      label: multiFilterLabel(
        t("canopy.fieldPriority"),
        state.priorityFilter,
        priorityOptions,
        true,
      ),
      clear: () => state.priorityFilter.clear(),
    });
  }
  if (state.attentionFilter.size) {
    activeFilters.push({
      id: "attention",
      label: multiFilterLabel(
        t("canopy.filterAttention"),
        state.attentionFilter,
        attentionOptions,
      ),
      clear: () => state.attentionFilter.clear(),
    });
  }
  if (state.donePeriod !== "all") {
    activeFilters.push({
      id: "done-period",
      label: t("canopy.filterChipValue", {
        field: t("canopy.filterDonePeriod"),
        value: t("canopy.filterLastWeek"),
      }),
      clear: () => {
        state.donePeriod = "all";
      },
    });
  }
  if (state.showArchived) {
    activeFilters.push({
      id: "archived",
      label: t("canopy.filterChipArchived"),
      clear: () => {
        state.showArchived = false;
      },
    });
  }
  const closeSearch = (event: Event, restoreFocus: boolean) => {
    if (!(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    const control = event.currentTarget.closest(".canopy-search-control");
    state.query = "";
    state.searchOpen = false;
    props.onRequestUpdate?.();
    if (restoreFocus) {
      queueMicrotask(() => control?.querySelector<HTMLButtonElement>("button")?.focus());
    }
  };
  const activeFilterCount = activeFilters.length;
  const hasActiveFilters = activeFilterCount > 0 || state.statusFilter.size > 0;
  const activeFiltering =
    hasActiveFilters ||
    Boolean(props.scopeAgentId) ||
    (props.showAgentFilter !== false && state.agentFilter !== "all") ||
    activeBoardFilter !== CANOPY_ALL_BOARDS_FILTER;
  const agentControl =
    props.scopeControl ??
    (props.showAgentFilter !== false &&
    listSelectableAgents(props.agentsList?.agents ?? []).length > 1
      ? renderSelectPicker({
          value: state.agentFilter,
          options: agentFilterOptions,
          accessibleLabel: t("canopy.fieldAgent"),
          onSelect: (value) => {
            if (!agentFilterOptions.some((option) => option.value === value)) {
              return;
            }
            state.agentFilter = value;
            props.onRequestUpdate?.();
          },
        })
      : nothing);
  const activeAgent =
    props.scopeAgentId || (props.showAgentFilter === false ? "all" : state.agentFilter);
  const agentSummary =
    activeAgent === "all"
      ? t("canopy.allAgents")
      : activeAgent === "default"
        ? (agentOptions.find((option) => option.id === "default")?.label ??
          t("canopy.defaultAgent"))
        : agentDisplayName(
            props.agentsList?.agents.find((agent) => agent.id === activeAgent),
            activeAgent,
          );
  const clearAgentFilter = props.scopeAgentId
    ? props.onClearAgentScope
    : props.showAgentFilter !== false
      ? () => {
          state.agentFilter = "all";
        }
      : undefined;
  if (activeAgent !== "all" && clearAgentFilter) {
    activeFilters.push({
      id: "agent",
      label: t("canopy.filterChipValue", {
        field: t("canopy.fieldAgent"),
        value: agentSummary,
      }),
      clear: clearAgentFilter,
      mobileOnly: true,
    });
  }
  const refreshStatus = state.loading ? t("common.refreshing") : refreshStatusLabel(state);
  // The active dialog owns the error alert while the board is inert.
  const dialogOpen =
    props.overlayOpen ||
    state.draftOpen ||
    Boolean(state.bulkDialog) ||
    Boolean(getVisibleDetailCard(state));
  return html`
    <section class="canopy">
      <div
        class="canopy-main"
        ?inert=${dialogOpen || state.bulkSaving}
        aria-hidden=${dialogOpen ? "true" : nothing}
      >
        <header class="canopy-heading">
          ${props.heading}
          <div class="canopy-heading__actions settings-section__actions">
            ${writable && props.onNewBoard ? html`<button class="btn canopy-new-board" type="button" @click=${props.onNewBoard}>${icons.plus}${t("canopy.newBoard")}</button>` : nothing}
            <span class="canopy-refresh-control" title=${refreshStatus || t("common.refresh")}>
              <button
                class="btn btn--icon btn--ghost canopy-refresh ${
                  state.lastRefreshError ? "canopy-refresh--error" : ""
                }"
                type="button"
                aria-label=${state.loading ? t("common.refreshing") : t("common.refresh")}
                aria-busy=${state.loading}
                ?disabled=${state.loading || state.dispatching || canopyHasActiveWrites(state)}
                @click=${props.onRefresh}
              >
                ${icons.refresh}
              </button>
            </span>
            ${
              writable
                ? html`
                    <button
                      class="btn canopy-dispatch"
                      type="button"
                      aria-label=${t("canopy.dispatch")}
                      title=${t(
                        activeBoardFilter === CANOPY_ALL_BOARDS_FILTER
                          ? "canopy.dispatchHelpAll"
                          : "canopy.dispatchHelp",
                      )}
                      ?disabled=${state.dispatching || canopyHasActiveWrites(state)}
                      @click=${() =>
                        dispatchCanopy({
                          host: props.host,
                          client: props.client,
                          requestUpdate: props.onRequestUpdate,
                        })}
                    >
                      ${icons.play}<span class="canopy-action-label"
                        >${t("canopy.dispatch")}</span
                      >
                    </button>
                  `
                : nothing
            }
            ${
              writable
                ? html`
                    <button
                      class="btn primary canopy-create"
                      type="button"
                      aria-label=${t("canopy.newCard")}
                      aria-haspopup="dialog"
                      aria-expanded=${state.draftOpen ? "true" : "false"}
                      aria-controls=${canopyCardModalId}
                      ?disabled=${state.dispatching}
                      @click=${() => {
                        openCreateModal(state, props);
                        props.onRequestUpdate?.();
                      }}
                    >
                      ${icons.plus}<span class="canopy-action-label"
                        >${t("canopy.newCard")}</span
                      >
                      <span class="canopy-create__short-label"
                        >${t("canopy.newCardShort")}</span
                      >
                    </button>
                  `
                : nothing
            }
          </div>
        </header>
        <div
          class="canopy-toolbar ${selectedCards.length ? "canopy-toolbar--selection" : ""}"
        >
          ${
            selectedCards.length
              ? renderSelectionActions(props)
              : html`<div class="canopy-toolbar__filters">
                  <div class="canopy-toolbar__navigation">
                    ${renderStatusTabs(state, props.onRequestUpdate)}
                    ${renderMobileStatusPicker(
                      state,
                      cardsForFilters("status"),
                      props.onRequestUpdate,
                    )}
                  </div>
                </div>`
          }
          <div class="canopy-toolbar__tools">
            <div class="canopy-search-control">
              ${
                state.searchOpen || state.query
                  ? html`<div class="canopy-search">
                      <span aria-hidden="true">${icons.search}</span>
                      <input
                        class="settings-input"
                        id="canopy-search-input"
                        type="search"
                        aria-label=${t("canopy.searchPlaceholder")}
                        placeholder=${t("canopy.searchPlaceholder")}
                        .value=${state.query}
                        @input=${(event: InputEvent) => {
                          if (!(event.currentTarget instanceof HTMLInputElement)) {
                            return;
                          }
                          state.query = event.currentTarget.value;
                          props.onRequestUpdate?.();
                        }}
                        @keydown=${(event: KeyboardEvent) => {
                          if (event.key !== "Escape") {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          closeSearch(event, true);
                        }}
                      />
                      <button
                        class="btn btn--icon canopy-search__clear"
                        type="button"
                        aria-label=${t("canopy.closeSearch")}
                        @click=${(event: MouseEvent) => closeSearch(event, event.detail === 0)}
                      >
                        ${icons.x}
                      </button>
                    </div>`
                  : html`<button
                      class="btn btn--icon canopy-search-trigger"
                      type="button"
                      aria-label=${t("canopy.searchPlaceholder")}
                      title=${t("canopy.searchPlaceholder")}
                      aria-expanded="false"
                      aria-controls="canopy-search-input"
                      @click=${(event: Event) => {
                        if (!(event.currentTarget instanceof HTMLElement)) {
                          return;
                        }
                        const control = event.currentTarget.closest(".canopy-search-control");
                        state.searchOpen = true;
                        props.onRequestUpdate?.();
                        queueMicrotask(() =>
                          control?.querySelector<HTMLInputElement>("input")?.focus(),
                        );
                      }}
                    >
                      ${icons.search}
                    </button>`
              }
            </div>
            ${
              agentControl === nothing
                ? nothing
                : html`<div class="canopy-agent-filter">${agentControl}</div>`
            }
            <button
              popovertarget=${canopyFilterPopoverId}
              class="btn canopy-filter-trigger ${activeFilterCount > 0 ? "active" : ""}"
              type="button"
              aria-label=${
                activeFilterCount > 0
                  ? t("canopy.filtersActive", { count: String(activeFilterCount) })
                  : t("canopy.filters")
              }
              aria-haspopup="dialog"
              aria-expanded="false"
            >
              ${icons.listFilter}<span>${t("canopy.filters")}</span>
              ${
                activeFilterCount > 0
                  ? html`<span class="canopy-filter-trigger__count">${activeFilterCount}</span>`
                  : nothing
              }
            </button>
            <div
              class="canopy-filter-popover"
              ${ref(canopyPopoverRef("end"))}
              id=${canopyFilterPopoverId}
              popover="auto"
              role="dialog"
              aria-label=${t("canopy.filters")}
            >
              <div class="canopy-filter-popover__panel">
                <div class="canopy-filter-heading">
                  <strong>${t("canopy.filters")}</strong>
                  ${
                    hasActiveFilters
                      ? html`<button
                          class="canopy-filter-clear"
                          type="button"
                          @click=${clearFilters}
                        >
                          ${t("canopy.clearFilters")}
                        </button>`
                      : nothing
                  }
                  <button
                    type="button"
                    class="btn btn--icon"
                    aria-label=${t("common.close")}
                    @click=${(event: Event) => {
                      if (!(event.currentTarget instanceof HTMLElement)) {
                        return;
                      }
                      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                    }}
                  >
                    ${icons.x}
                  </button>
                </div>
                ${
                  agentControl === nothing
                    ? nothing
                    : html`<div class="canopy-filter-agent canopy-filter-choice">
                        <span class="canopy-filter-section__label"
                          >${t("canopy.fieldAgent")}</span
                        >
                        ${agentControl}
                      </div>`
                }
                <div class="canopy-filter-display">
                  ${renderFilterChoices({
                    label: t("canopy.filterLayout"),
                    value: state.viewMode,
                    options: [
                      { value: "board", label: t("canopy.viewBoard"), icon: "kanban" },
                      { value: "list", label: t("canopy.viewList"), icon: "list" },
                    ],
                    onChange: (value) => {
                      state.viewMode = value;
                      props.onRequestUpdate?.();
                    },
                  })}
                  ${renderFilterChoices({
                    label: t("canopy.filterDensity"),
                    value: state.layout,
                    options: [
                      {
                        value: "comfortable",
                        label: t("canopy.densityComfortable"),
                        icon: "layoutComfortable",
                      },
                      {
                        value: "compact",
                        label: t("canopy.densityCompact"),
                        icon: "layoutCompact",
                      },
                    ],
                    onChange: (value) => {
                      state.layout = value;
                      props.onRequestUpdate?.();
                    },
                  })}
                  ${renderFilterChoices({
                    label: t("canopy.emptyColumns"),
                    value: state.emptyColumnMode,
                    options: [
                      {
                        value: "show",
                        label: t("canopy.emptyColumnsShow"),
                        icon: "eye",
                        title: t("canopy.showEmptyColumns"),
                      },
                      {
                        value: "collapse",
                        label: t("canopy.emptyColumnsCollapse"),
                        icon: "minimize",
                        title: t("canopy.collapseEmptyColumns"),
                      },
                      {
                        value: "hide",
                        label: t("canopy.emptyColumnsHide"),
                        icon: "eyeOff",
                        title: t("canopy.hideEmptyColumns"),
                      },
                    ],
                    onChange: (value) => {
                      state.emptyColumnMode = value;
                      state.expandedEmptyStatuses.clear();
                      props.onRequestUpdate?.();
                    },
                  })}
                </div>
                ${renderMultiFilter({
                  label: t("canopy.fieldPriority"),
                  values: state.priorityFilter,
                  options: priorityOptions,
                  onChange: () => props.onRequestUpdate?.(),
                })}
                ${renderMultiFilter({
                  label: t("canopy.filterAttention"),
                  values: state.attentionFilter,
                  options: attentionOptions,
                  wide: true,
                  onChange: () => props.onRequestUpdate?.(),
                })}
                <div class="canopy-filter-fields">
                  ${renderFilterSelect({
                    value: state.donePeriod,
                    options: [
                      { value: "all", label: t("canopy.filterAllTime") },
                      { value: "week", label: t("canopy.filterLastWeek") },
                    ],
                    label: t("canopy.filterDonePeriod"),
                    onChange: (value) => {
                      state.donePeriod = value;
                      props.onRequestUpdate?.();
                    },
                  })}
                  ${
                    boardOptions.length >= 3
                      ? renderFilterSelect({
                          value: activeBoardFilter,
                          options: boardOptions,
                          label: t("canopy.boardFilter"),
                          onChange: (value) => {
                            state.boardFilter = value;
                            props.onBoardFilterChange?.(value);
                            props.onRequestUpdate?.();
                          },
                        })
                      : nothing
                  }
                  <label class="canopy-filter-row canopy-filter-archived">
                    <span>${t("canopy.showArchived")}</span>
                    <input
                      type="checkbox"
                      role="switch"
                      .checked=${state.showArchived}
                      @change=${(event: Event) => {
                        if (!(event.currentTarget instanceof HTMLInputElement)) {
                          return;
                        }
                        state.showArchived = event.currentTarget.checked;
                        props.onRequestUpdate?.();
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
          ${
            !selectedCards.length && activeFilters.length
              ? renderActiveFilters(activeFilters, props.onRequestUpdate)
              : nothing
          }
        </div>
        ${
          (filtered.length === 0 && activeFiltering) || visibleStatuses.length === 0
            ? html`
                <div class="canopy-empty-state" role="status">
                  <strong>${t("canopy.emptyFilteredTitle")}</strong>
                  <span>${t("canopy.emptyFilteredHint")}</span>
                  ${
                    hasActiveFilters
                      ? html`<button class="btn" type="button" @click=${clearFilters}>
                          ${t("canopy.clearFilters")}
                        </button>`
                      : nothing
                  }
                </div>
              `
            : html`
                <div
                  class="canopy-board-viewport ${
                    state.viewMode === "list" ? "canopy-board-viewport--list" : ""
                  }"
                >
                  <div
                    ${ref(boardScrollEdgesRef())}
                    class="canopy-board canopy-board--page canopy-board--${state.layout} ${
                      state.viewMode === "list" ? "canopy-board--list" : ""
                    } ${visibleStatuses.length === 1 ? "canopy-board--single-column" : ""}"
                  >
                    ${
                      state.viewMode === "list"
                        ? html`<div class="canopy-list-header" aria-hidden="true">
                            <span>${t("canopy.fieldPriority")}</span>
                            <span>${t("canopy.fieldTitle")}</span>
                            <span>${t("canopy.fieldSession")}</span>
                            <span>${t("canopy.detailUpdated")}</span>
                            <span></span>
                          </div>`
                        : nothing
                    }
                    ${visibleStatuses.map((status) =>
                      renderColumn(props, status, byStatus.get(status) ?? [], {
                        surface: state.viewMode === "list" ? "list" : "page",
                      }),
                    )}
                  </div>
                </div>
              `
        }
      </div>
      ${renderCanopyToast({
        owner: state,
        outcomeSource: true,
        message:
          visibleError ??
          (state.bulkResult
            ? t("canopy.bulkResult", {
                completed: String(state.bulkResult.completed),
                total: String(state.bulkResult.total),
              })
            : dispatchSummaryMessage(state)),
        hidden: dialogOpen,
        key: visibleError ?? state.bulkResult ?? state.lastDispatchSummary,
        tone: visibleError ? "error" : "info",
      })}
      ${renderCardModal(props)} ${renderCardDetailsPanel(props)} ${renderSelectionDialog(props)}
    </section>
  `;
}
