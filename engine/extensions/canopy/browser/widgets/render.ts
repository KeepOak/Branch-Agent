import { html, nothing, type TemplateResult } from "lit";
import { t } from "../i18n/index.ts";
import {
  canopyCardBoardId,
  matchesBoardFilter,
  CANOPY_ALL_BOARDS_FILTER,
} from "../lib/canopy/board-filter.ts";
import {
  CANOPY_STATUSES,
  type CanopyCard,
  type CanopyStatus,
} from "../lib/canopy/types.ts";
import { renderColumn } from "../pages/canopy/view-card.ts";
import type { CanopyProps } from "../pages/canopy/view-helpers.ts";
import { canopyPageTarget } from "../pages/canopy/canopy-page.ts";
import type { CanopyWidgetModel } from "./runtime.ts";

function renderAvailability(model: CanopyWidgetModel): TemplateResult | null {
  if (!model.connected) {
    return html`<p class="canopy-widget__state" role="status">
      ${t("canopy.widget.disconnected")}
    </p>`;
  }
  if (!model.loaded && !model.error) {
    return html`<p class="canopy-widget__state">${t("canopy.widget.loading")}</p>`;
  }
  if (model.error) {
    return html`<div class="canopy-widget__state" role="alert">
      <span>${model.error}</span>
      <button class="btn btn--sm" type="button" @click=${() => model.retryLoad()}>
        ${t("common.retry")}
      </button>
    </div>`;
  }
  return null;
}

export function renderCanopyMiniWidget(model: CanopyWidgetModel): TemplateResult {
  const availability = renderAvailability(model);
  if (availability) {
    return availability;
  }
  // No boardId prop means every board: silently scoping to "default" hides
  // cards created with an explicit board id and renders an all-zero widget.
  const boardId = model.readStringProp("boardId");
  const limit = Math.min(10, model.readPositiveIntegerProp("limit", 5));
  const cards = boardId
    ? model.cards.filter((card) => canopyCardBoardId(card) === boardId)
    : model.cards;
  const topCards = cards
    .filter((card) => card.status === "ready" || card.status === "running")
    .toSorted(
      (left, right) =>
        Number(right.status === "running") - Number(left.status === "running") ||
        left.position - right.position ||
        left.title.localeCompare(right.title),
    )
    .slice(0, limit);
  const canopyPath = model.host.navigation.pageHref(canopyPageTarget(boardId));
  return html`
    <section class="canopy-widget-mini" data-test-id="canopy-mini-widget">
      <header>
        <strong>${boardId ?? t("canopy.allBoards")}</strong>
        <a href=${canopyPath}>${t("canopy.widget.openBoard")}</a>
      </header>
      <div class="canopy-widget-mini__counts" aria-label=${t("canopy.widget.statusCounts")}>
        ${CANOPY_STATUSES.map(
          (status) => html`
            <span title=${t(`canopy.status.${status}`)}>
              <b>${cards.filter((card) => card.status === status).length}</b>
              ${t(`canopy.status.${status}`)}
            </span>
          `,
        )}
      </div>
      <div class="canopy-widget-mini__cards">
        ${
          topCards.length > 0
            ? topCards.map(
                (card) => html`
                  <div class="canopy-widget-mini__card">
                    <span
                      class=${`canopy-widget__status canopy-widget__status--${card.status}`}
                    >
                      ${t(`canopy.status.${card.status}`)}
                    </span>
                    <strong>${card.title}</strong>
                  </div>
                `,
              )
            : html`<p class="canopy-widget__state">${t("canopy.widget.noActiveCards")}</p>`
        }
      </div>
    </section>
  `;
}

export function renderCanopyCardWidget(model: CanopyWidgetModel): TemplateResult {
  const cardId = model.readStringProp("cardId");
  if (!cardId) {
    return html`<p class="canopy-widget__state" role="alert">
      ${t("canopy.widget.cardIdRequired")}
    </p>`;
  }
  const availability = renderAvailability(model);
  if (availability) {
    return availability;
  }
  const card = model.cards.find((candidate) => candidate.id === cardId);
  if (!card) {
    return html`<p class="canopy-widget__state">${t("canopy.widget.cardMissing")}</p>`;
  }
  const statuses = model.statuses.includes(card.status)
    ? model.statuses
    : [card.status, ...model.statuses];
  const priority = card.priority.charAt(0).toUpperCase() + card.priority.slice(1);
  return html`
    <article class="canopy-widget-card" data-test-id="canopy-card-widget">
      <div class="canopy-widget-card__heading">
        <strong>${card.title}</strong>
        <span class=${`canopy-widget__status canopy-widget__status--${card.status}`}>
          ${t(`canopy.status.${card.status}`)}
        </span>
      </div>
      <dl class="canopy-widget-card__meta">
        <div>
          <dt>${t("canopy.fieldPriority")}</dt>
          <dd>${priority}</dd>
        </div>
        <div>
          <dt>${t("canopy.fieldAgent")}</dt>
          <dd>${card.agentId ?? t("canopy.widget.unassigned")}</dd>
        </div>
      </dl>
      ${
        statuses.length > 1
          ? html`
              <label class="canopy-widget-card__move">
                <span>${t("canopy.fieldStatus")}</span>
                <select
                  aria-label=${`${t("canopy.fieldStatus")}: ${card.title}`}
                  .value=${card.status}
                  ?disabled=${!model.canMutate}
                  @change=${(event: Event) => void model.handleStatusChange(event)}
                >
                  ${statuses.map(
                    (status) => html`
                      <option value=${status} ?selected=${status === card.status}>
                        ${t(`canopy.status.${status}`)}
                      </option>
                    `,
                  )}
                </select>
              </label>
            `
          : nothing
      }
    </article>
  `;
}

export function renderCanopyBoardWidget(model: CanopyWidgetModel): TemplateResult {
  const availability = renderAvailability(model);
  if (availability) {
    return availability;
  }

  // No boardId prop means every board, matching the summary widget. Defaulting
  // here would silently hide cards owned by explicitly named boards.
  const boardId = model.readStringProp("boardId");
  const filter = boardId ?? CANOPY_ALL_BOARDS_FILTER;
  const cards = model.cards.filter((card) => matchesBoardFilter(card, filter));
  const byStatus = new Map<CanopyStatus, CanopyCard[]>();
  for (const status of model.statuses) {
    byStatus.set(status, []);
  }
  for (const card of cards) {
    byStatus.get(card.status)?.push(card);
  }

  // Hidden widgets retain their controls; mutation admission must follow the current lease.
  const props: CanopyProps = {
    host: model.canopyStateHost,
    get client() {
      return model.canopyClient;
    },
    get connected() {
      return model.connected;
    },
    get canWrite() {
      return model.canMutate;
    },
    agentsList: null,
    sessions: [],
    onOpenSession: model.host.sessions.open,
    onRequestUpdate: () => model.runtime.notify(),
  };
  const canopyPath = model.host.navigation.pageHref(canopyPageTarget(boardId));

  return html`
    <section class="canopy-widget-board" data-test-id="canopy-board-widget">
      <header class="canopy-widget-board__header">
        <strong>${boardId ?? t("canopy.allBoards")}</strong>
        <span>${t("canopy.widget.cardCount", { count: String(cards.length) })}</span>
        <a href=${canopyPath}>${t("canopy.widget.openBoard")}</a>
      </header>
      <div class="canopy-board canopy-board--compact canopy-widget-board__columns">
        ${model.statuses.map((status) =>
          renderColumn(props, status, byStatus.get(status) ?? [], {
            surface: "widget",
            boardFilter: filter,
          }),
        )}
      </div>
    </section>
  `;
}
