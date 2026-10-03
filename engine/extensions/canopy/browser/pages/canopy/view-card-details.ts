import { html, nothing } from "lit";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import {
  renderAgentAvatar,
  renderSessionSummary,
  renderDialog,
} from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyToast } from "../../components/toast.ts";
import { t } from "../../i18n/index.ts";
import {
  canopyCardBoardId,
  CANOPY_ALL_BOARDS_FILTER,
} from "../../lib/canopy/board-filter.ts";
import { canopyBoardName } from "../../lib/canopy/board-presentation.ts";
import {
  addCanopyCardComment,
  getCanopyDependencyState,
  getCanopyLifecycle,
  getCanopyState,
  type CanopyCard,
  type CanopyUiState,
} from "../../lib/canopy/index.ts";
import { cardAgentLabel } from "./agent-filter.ts";
import { automationDetailFields, renderBoardAutomation } from "./view-automation.ts";
import {
  getCardActionState,
  renderArchiveCardAction,
  renderDeleteCardAction,
  renderEditCardAction,
  renderOpenSessionCardAction,
  renderStartExecutionButton,
  renderStopCardAction,
} from "./view-card-actions.ts";
import {
  renderDependencyDetailList,
  renderDetailRow,
  renderTechnicalDetails,
} from "./view-card-detail-records.ts";
import { renderCardDiscardDialog } from "./view-card-modal.ts";
import {
  formatEventLabel,
  formatLifecycle,
  formatPriorityLabel,
  canopyErrorMessage,
  renderPriorityIcon,
  renderLifecycleIcon,
  formatStatusLabel,
  formatUpdatedTime,
  type CanopyProps,
} from "./view-helpers.ts";
import {
  renderInlineAgent,
  renderInlinePriority,
  renderInlineStatus,
  renderInlineText,
  type CanopyInlineText,
} from "./view-inline-properties.ts";
import { closeCanopyPopoverOnAction, canopyPopoverRef } from "./view-popover.ts";
import { canopyScrollFadeRef } from "./view-scroll-fade.ts";
import { getSessionStatus, renderSessionStatusBadge } from "./view-session-status.ts";

export const canopyCardDetailDrawerId = "canopy-card-detail-drawer";
const canopyCardDetailTitleId = "canopy-card-detail-title";
const canopyCardDetailDescriptionId = "canopy-card-detail-description";

const detailDrawerRefs = new WeakMap<CanopyUiState, Ref<HTMLElement>>();
const inlineDiscardOpen = new WeakMap<CanopyUiState, () => void>();

export function openCardDetails(state: CanopyUiState, card: CanopyCard) {
  inlineDiscardOpen.delete(state);
  state.detailCardId = card.id;
  state.detailTab = "overview";
  state.detailCommentBody = state.detailCommentDrafts.get(card.id) ?? "";
}

function closeCardDetails(state: CanopyUiState) {
  inlineDiscardOpen.delete(state);
  state.detailCardId = null;
  state.detailTab = "overview";
  state.detailCommentBody = "";
}

export function getVisibleDetailCard(state: CanopyUiState): CanopyCard | null {
  if (!state.detailCardId || state.draftOpen) {
    return null;
  }
  const card = state.cards.find((entry) => entry.id === state.detailCardId) ?? null;
  if (card?.metadata?.archivedAt && !state.showArchived) {
    const editors = detailDrawerRefs
      .get(state)
      ?.value?.querySelectorAll<CanopyInlineText>("canopy-inline-text");
    const hasDraft = [...(editors ?? [])].some(
      (editor) =>
        editor.props.card.id === card.id && (editor.hasUnsavedChanges || editor.pendingSave),
    );
    if (!hasDraft) {
      return null;
    }
  }
  return card;
}

export function renderCardDetailsPanel(props: CanopyProps) {
  const state = getCanopyState(props.host);
  const visibleError = canopyErrorMessage(state, props.pageError);
  const card = getVisibleDetailCard(state);
  if (!card) {
    inlineDiscardOpen.delete(state);
    return nothing;
  }
  const drawer = detailDrawerRefs.get(state) ?? createRef<HTMLElement>();
  detailDrawerRefs.set(state, drawer);
  const inlineEditors = () => [
    ...(drawer.value?.querySelectorAll<CanopyInlineText>("canopy-inline-text") ?? []),
  ];
  const requestTransition = (transition: () => void) => {
    const editors = inlineEditors();
    if (editors.some((editor) => editor.pendingSave)) {
      return false;
    }
    if (editors.some((editor) => editor.hasUnsavedChanges)) {
      inlineDiscardOpen.set(state, transition);
      props.onRequestUpdate?.();
      return false;
    }
    transition();
    return true;
  };
  const dismissDetails = () =>
    requestTransition(() => {
      closeCardDetails(state);
      props.onRequestUpdate?.();
    });
  const navigateAutomation = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const link = event.currentTarget;
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) {
      return;
    }
    let requesting = true;
    const proceed = requestTransition(() => {
      // Clean clicks retain native navigation. Replay a deferred click only after discard.
      if (!requesting && link.isConnected) {
        link.click();
      }
    });
    requesting = false;
    if (!proceed) {
      event.preventDefault();
    }
  };
  const actionProps = {
    ...props,
    onOpenSession: (session: Parameters<CanopyProps["onOpenSession"]>[0]) => {
      requestTransition(() => props.onOpenSession(session));
    },
  };
  const { busy, live, linkedSessionKey, sessionTarget, writable, showStartControls, archived } =
    getCardActionState(props, card);
  const selectTab = (tab: CanopyUiState["detailTab"], target: EventTarget | null) => {
    if (tab !== state.detailTab && target instanceof HTMLElement) {
      const body = target
        .closest(".canopy-detail")
        ?.querySelector<HTMLElement>(".canopy-detail__body");
      if (body) {
        body.scrollTop = 0;
      }
    }
    state.detailTab = tab;
    props.onRequestUpdate?.();
  };
  const lifecycle = getCanopyLifecycle(card, props.sessions, props.sessionResolution);
  const formatted = formatLifecycle(lifecycle);
  const sessionStatus = getSessionStatus(card, lifecycle);
  const comments = card.metadata?.comments ?? [];
  const automation = card.metadata?.automation;
  const boardId = canopyCardBoardId(card);
  const board = state.boards.find((entry) => entry.id === boardId);
  const events = (card.events ?? []).toReversed();
  const dependencies = getCanopyDependencyState(card, state.cards);
  const technicalDetails = renderTechnicalDetails(
    card,
    linkedSessionKey,
    state.detailTab === "details",
  );
  const hasTechnicalDetails = technicalDetails !== nothing;
  const tabs = [
    { id: "overview", label: t("canopy.detailTabOverview") },
    { id: "activity", label: t("canopy.detailTabActivity") },
    ...(sessionTarget ? [{ id: "session", label: t("canopy.detailTabSession") } as const] : []),
    ...(hasTechnicalDetails
      ? [{ id: "details", label: t("canopy.detailTabDetails") } as const]
      : []),
  ] as const;
  const activeTab = tabs.some((tab) => tab.id === state.detailTab) ? state.detailTab : "overview";
  const sessionStateLabel = formatted.label;
  const sessionEmpty = lifecycle.state === "unlinked" && !linkedSessionKey;
  const renderSessionHeading = (tab: "overview" | "session") => html`<div
    class="canopy-detail__execution-main"
  >
    <div class="canopy-detail__session-row" title=${formatted.detail}>
      ${
        sessionEmpty || !sessionStatus.visible
          ? html`<span
              class="canopy-detail__session-state-icon"
              role="img"
              aria-label=${sessionStateLabel}
              title=${sessionStateLabel}
            >
              ${sessionEmpty ? icons.bot : renderLifecycleIcon(lifecycle)}
            </span>`
          : nothing
      }
      <div class="canopy-detail__session-copy">
        <span
          class="canopy-detail__session-name"
          id=${tab === "overview" ? canopyCardDetailDescriptionId : nothing}
        >
          ${
            sessionEmpty
              ? t("canopy.detailNoSessionYet")
              : (lifecycle.session?.displayName ??
                lifecycle.session?.label ??
                (linkedSessionKey ? t("canopy.fieldSession") : formatted.label))
          }
        </span>
        ${
          !sessionEmpty && sessionStatus.detail
            ? html`<p
                class="canopy-detail__session-description"
                .textContent=${sessionStatus.detail}
              ></p>`
            : nothing
        }
        ${
          sessionEmpty && showStartControls && !archived
            ? html`<p class="canopy-detail__session-help">
                ${t("canopy.detailStartSessionHelp", {
                  agent: cardAgentLabel(card, props.agentsList),
                })}
              </p>`
            : nothing
        }
      </div>
      ${renderSessionStatusBadge(sessionStatus)}
    </div>
    <div class="canopy-detail__actions">
      ${
        tab === "overview" && showStartControls
          ? renderStartExecutionButton(actionProps, card, null, "autonomous")
          : nothing
      }
      ${
        tab === "overview" && writable && linkedSessionKey && live
          ? renderStopCardAction(props, card, busy)
          : nothing
      }
      ${renderOpenSessionCardAction(actionProps, sessionTarget, { quiet: true })}
    </div>
  </div>`;
  const visibleAutomationFields = automationDetailFields(automation);
  const detailsDialog = renderDialog(
    {
      className: "drawer drawer--floating",
      label: card.title,
      description: lifecycle.session?.displayName ?? formatted.detail,
      style:
        "--branch-modal-width: 620px; --branch-modal-backdrop-filter: none; --wa-color-overlay-modal: rgba(0, 0, 0, 0.24);",
      onCancel: dismissDetails,
    },
    html`
      <aside id=${canopyCardDetailDrawerId} class="canopy-detail-drawer" ${ref(drawer)}>
        <div class="canopy-detail">
          <header class="canopy-detail__header">
            <h2 id=${canopyCardDetailTitleId}>
              <span class="sr-only">${t("canopy.detailTitle")}: </span>${renderInlineText(
                props,
                card,
                "title",
                busy,
                !writable || archived,
              )}
            </h2>
            <div class="canopy-detail__header-actions">
              ${
                writable
                  ? html`
                      <button
                        class="btn btn--icon canopy-detail__icon"
                        type="button"
                        popovertarget="canopy-detail-actions"
                        aria-label=${t("canopy.cardActions")}
                        aria-haspopup="true"
                        aria-expanded="false"
                      >
                        ${icons.moreHorizontal}
                      </button>
                      <div
                        id="canopy-detail-actions"
                        class="canopy-detail__menu"
                        popover="auto"
                        role="group"
                        aria-label=${t("canopy.cardActions")}
                        ${ref(canopyPopoverRef("end"))}
                        @click=${closeCanopyPopoverOnAction}
                      >
                        ${!archived ? renderEditCardAction(props, card, { requestAction: requestTransition }) : nothing}
                        ${renderArchiveCardAction(props, card, busy, archived, { requestAction: requestTransition })}
                        ${renderDeleteCardAction(props, card, busy, { requestAction: requestTransition })}
                      </div>
                    `
                  : nothing
              }
              <button
                class="btn btn--icon canopy-detail__icon canopy-detail__close"
                type="button"
                aria-label=${t("common.close")}
                @click=${dismissDetails}
              >
                ${icons.x}
              </button>
            </div>
          </header>
          <div
            class="canopy-detail__tabs"
            role="tablist"
            aria-label=${t("canopy.detailTitle")}
            @keydown=${(event: KeyboardEvent) => {
              const index = tabs.findIndex((tab) => tab.id === activeTab);
              let next: number;
              if (event.key === "ArrowRight") {
                next = (index + 1) % tabs.length;
              } else if (event.key === "ArrowLeft") {
                next = (index + tabs.length - 1) % tabs.length;
              } else if (event.key === "Home") {
                next = 0;
              } else if (event.key === "End") {
                next = tabs.length - 1;
              } else {
                return;
              }
              const nextTab = tabs[next];
              if (!nextTab) {
                return;
              }
              event.preventDefault();
              selectTab(nextTab.id, event.currentTarget);
              if (event.currentTarget instanceof HTMLElement) {
                const buttons =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]");
                buttons[next]?.focus();
              }
            }}
          >
            ${tabs.map(
              (tab) => html`<button
                type="button"
                role="tab"
                id=${`canopy-detail-tab-${tab.id}`}
                aria-controls=${`canopy-detail-panel-${tab.id}`}
                aria-selected=${String(activeTab === tab.id)}
                tabindex=${activeTab === tab.id ? "0" : "-1"}
                ?autofocus=${activeTab === tab.id}
                @click=${(event: MouseEvent) => selectTab(tab.id, event.currentTarget)}
              >
                ${tab.label}
              </button>`,
            )}
          </div>
          <div class="canopy-detail__body" ${ref(canopyScrollFadeRef())}>
            <section
              class="canopy-detail__tabpanel"
              id="canopy-detail-panel-overview"
              role="tabpanel"
              aria-labelledby="canopy-detail-tab-overview"
              tabindex="0"
              ?hidden=${activeTab !== "overview"}
            >
              <div class="canopy-detail__layout">
                <aside
                  class="canopy-detail__properties"
                  aria-label=${t("canopy.detailProperties")}
                >
                  <div class="canopy-detail__row">
                    <span>${t("canopy.fieldStatus")}</span>
                    ${
                      writable && !archived && state.statuses.length > 1
                        ? renderInlineStatus(props, card, busy)
                        : html`<strong>${formatStatusLabel(card.status)}</strong>`
                    }
                  </div>
                  <div class="canopy-detail__row">
                    <span>${t("canopy.fieldPriority")}</span>
                    ${
                      writable && !archived
                        ? renderInlinePriority(props, card, busy)
                        : html`<strong
                            class="canopy-detail__priority canopy-detail__priority--${card.priority}"
                          >
                            ${renderPriorityIcon(card.priority)}${formatPriorityLabel(card.priority)}
                          </strong>`
                    }
                  </div>
                  <div class="canopy-detail__row">
                    <span>${t("canopy.fieldAgent")}</span>
                    ${
                      writable && !archived
                        ? renderInlineAgent(props, card, busy)
                        : html`<strong class="canopy-detail__agent">
                            ${renderAgentAvatar({
                              agentId:
                                card.agentId?.trim() ||
                                props.agentsList?.defaultId ||
                                props.defaultAgentId ||
                                "",
                              label: cardAgentLabel(card, props.agentsList),
                            })}
                            <span>${cardAgentLabel(card, props.agentsList)}</span>
                          </strong>`
                    }
                  </div>
                  ${renderDetailRow(
                    t("canopy.detailUpdated"),
                    formatUpdatedTime(card.updatedAt),
                  )}
                  ${
                    state.boardFilter === CANOPY_ALL_BOARDS_FILTER
                      ? renderDetailRow(
                          t("canopy.detailBoard"),
                          canopyBoardName(board ?? { id: boardId }),
                        )
                      : nothing
                  }
                  <div class="canopy-detail__label-group">
                    <span>${t("canopy.fieldLabels")}</span>
                    ${renderInlineText(props, card, "labels", busy, !writable || archived)}
                  </div>
                </aside>
                <div class="canopy-detail__content">
                  ${renderInlineText(props, card, "notes", busy, !writable || archived)}
                  <section
                    class="canopy-detail__execution ${
                      sessionEmpty ? "canopy-detail__execution--empty" : ""
                    }"
                    aria-label=${t("canopy.fieldSession")}
                  >
                    ${renderSessionHeading("overview")}
                    ${
                      showStartControls
                        ? html`
                            <details
                              class="canopy-detail__disclosure canopy-detail__engine-options"
                            >
                              <summary>
                                <span
                                  class="canopy-detail__disclosure-chevron"
                                  aria-hidden="true"
                                  >${icons.chevronDown}</span
                                >
                                ${t("canopy.detailExecutionOptions")}
                              </summary>
                              <div class="canopy-detail__engine-groups">
                                ${
                                  props.canModelOverride !== false
                                    ? html`
                                        <div class="canopy-detail__engine-group">
                                          <span>${t("canopy.detailRunAutomatically")}</span>
                                          <div class="canopy-detail__actions">
                                            ${renderStartExecutionButton(
                                              actionProps,
                                              card,
                                              "codex",
                                              "autonomous",
                                            )}
                                            ${renderStartExecutionButton(
                                              actionProps,
                                              card,
                                              "claude",
                                              "autonomous",
                                            )}
                                          </div>
                                        </div>
                                      `
                                    : nothing
                                }
                                <div class="canopy-detail__engine-group">
                                  <span>${t("canopy.detailOpenManually")}</span>
                                  <div class="canopy-detail__actions">
                                    ${renderStartExecutionButton(
                                      actionProps,
                                      card,
                                      "codex",
                                      "manual",
                                    )}
                                    ${renderStartExecutionButton(
                                      actionProps,
                                      card,
                                      "claude",
                                      "manual",
                                    )}
                                  </div>
                                </div>
                              </div>
                            </details>
                          `
                        : nothing
                    }
                  </section>
                  ${renderBoardAutomation(props.detailBoardAutomation, navigateAutomation)}
                  ${
                    automation?.summary || visibleAutomationFields.length
                      ? html`<section
                          class="canopy-detail__section canopy-detail__automation"
                        >
                          <h3>${t("canopy.detailCardAutomation")}</h3>
                          ${automation?.summary ? html`<p>${automation.summary}</p>` : nothing}
                          ${visibleAutomationFields.map(([label, value]) =>
                            renderDetailRow(label, value),
                          )}
                        </section>`
                      : nothing
                  }
                  ${renderDependencyDetailList(dependencies)}
                </div>
              </div>
            </section>
            <section
              class="canopy-detail__tabpanel canopy-detail__activity-panel"
              id="canopy-detail-panel-activity"
              role="tabpanel"
              aria-labelledby="canopy-detail-tab-activity"
              tabindex="0"
              ?hidden=${activeTab !== "activity"}
            >
              <section class="canopy-detail__section canopy-detail__activity">
                ${
                  events.length
                    ? html`
                        <h3>${t("canopy.eventsLabel")}</h3>
                        <ol class="canopy-detail__list canopy-detail__events">
                          ${events.map(
                            (event) => html`<li>
                              <span>${formatEventLabel(event)}</span>
                              <time>${formatUpdatedTime(event.at)}</time>
                            </li>`,
                          )}
                        </ol>
                      `
                    : nothing
                }
                ${
                  comments.length
                    ? html`
                        <h3>${t("canopy.detailOperatorNotes")}</h3>
                        <ol class="canopy-detail__list canopy-detail__comments">
                          ${comments.map(
                            (comment) => html`<li>
                              <span>${comment.body}</span>
                              <time>${formatUpdatedTime(comment.createdAt)}</time>
                            </li>`,
                          )}
                        </ol>
                      `
                    : !events.length
                      ? html`<p class="canopy-detail__empty">${t("canopy.detailNoNotes")}</p>`
                      : nothing
                }
                ${
                  writable
                    ? html`
                        <div class="canopy-detail__comment-compose">
                          <textarea
                            class="settings-input canopy-detail__note"
                            aria-label=${t("canopy.detailOperatorNotes")}
                            rows="2"
                            maxlength="2000"
                            placeholder=${t("canopy.detailNotePlaceholder")}
                            .value=${state.detailCommentBody}
                            ?disabled=${busy}
                            @input=${(event: InputEvent) => {
                              if (!(event.currentTarget instanceof HTMLTextAreaElement)) {
                                return;
                              }
                              state.detailCommentBody = event.currentTarget.value;
                              state.detailCommentDrafts.set(card.id, state.detailCommentBody);
                              props.onRequestUpdate?.();
                            }}
                          ></textarea>
                          <button
                            class="btn"
                            type="button"
                            ?disabled=${busy || !state.detailCommentBody.trim()}
                            @click=${() =>
                              addCanopyCardComment({
                                host: props.host,
                                client: props.client,
                                cardId: card.id,
                                body: state.detailCommentBody,
                                requestUpdate: props.onRequestUpdate,
                              })}
                          >
                            ${t("canopy.detailAddNote")}
                          </button>
                        </div>
                      `
                    : nothing
                }
              </section>
            </section>
            ${technicalDetails}
            ${
              sessionTarget
                ? html`<section
                    class="canopy-detail__tabpanel canopy-detail__session-panel"
                    id="canopy-detail-panel-session"
                    role="tabpanel"
                    aria-labelledby="canopy-detail-tab-session"
                    tabindex="0"
                    ?hidden=${activeTab !== "session"}
                  >
                    ${renderSessionHeading("session")}
                    ${
                      activeTab === "session"
                        ? renderSessionSummary({
                            session: sessionTarget,
                            presented: props.presented !== false,
                          })
                        : nothing
                    }
                  </section>`
                : nothing
            }
          </div>
        </div>
      </aside>
      ${renderCanopyToast({
        owner: state,
        message: visibleError ?? "",
        key: visibleError,
        tone: "error",
      })}
    `,
  );
  return html`
    ${detailsDialog}
    ${
      inlineDiscardOpen.has(state)
        ? renderCardDiscardDialog({
            title: t("canopy.discardChangesTitle"),
            onKeepEditing: () => {
              inlineDiscardOpen.delete(state);
              props.onRequestUpdate?.();
            },
            onDiscard: () => {
              const transition = inlineDiscardOpen.get(state);
              inlineDiscardOpen.delete(state);
              for (const editor of inlineEditors()) {
                editor.discardDraft();
              }
              transition?.();
              props.onRequestUpdate?.();
            },
          })
        : nothing
    }
  `;
}
