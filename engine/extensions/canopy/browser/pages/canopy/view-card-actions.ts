import type { BoardGetParams } from "@branch/gateway-protocol";
import { html, nothing, type TemplateResult } from "lit";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import {
  isActiveCanopyCard,
  nextCanopyCardPosition,
  canopyCardSessionKey,
} from "../../lib/canopy/card-state.ts";
import { canStartCanopyCard } from "../../lib/canopy/execution.ts";
import {
  archiveCanopyCard,
  deleteCanopyCard,
  findCanopySession,
  getCanopyState,
  moveCanopyCard,
  startCanopyCard,
  stopCanopyCard,
  type CanopyCard,
  type CanopyExecutionEngine,
  type CanopyExecutionMode,
  type CanopyStatus,
} from "../../lib/canopy/index.ts";
import { canopyCardSessionTarget } from "../../lib/canopy/session-resolution.ts";
import { openEditModal } from "./view-card-modal.ts";
import {
  canMutate,
  cardHasUnresolvedStartedRun,
  engineBlockedByRuntime,
  formatStatusLabel,
  type CanopyProps,
} from "./view-helpers.ts";

export async function moveCardToStatus(
  props: CanopyProps,
  card: CanopyCard,
  status: CanopyStatus,
) {
  const state = getCanopyState(props.host);
  if (
    !isActiveCanopyCard(card) ||
    status === card.status ||
    state.busyCardIds.has(card.id) ||
    state.dispatching ||
    !canMutate(props) ||
    !props.connected ||
    !props.client
  ) {
    return;
  }
  await moveCanopyCard({
    host: props.host,
    client: props.client,
    cardId: card.id,
    status,
    position: nextCanopyCardPosition(state.cards, card, status),
    requestUpdate: props.onRequestUpdate,
  });
}

export function renderCardMoveControl(
  props: CanopyProps,
  card: CanopyCard,
  busy: boolean,
  options: { wide?: boolean } = {},
) {
  const state = getCanopyState(props.host);
  const statuses = state.statuses.includes(card.status)
    ? state.statuses
    : [card.status, ...state.statuses];
  if (!isActiveCanopyCard(card) || statuses.length < 2) {
    return nothing;
  }
  return html`
    <label
      class="canopy-card__move ${options.wide ? "canopy-card__move--wide" : ""}"
      title=${t("canopy.fieldStatus")}
    >
      <select
        class="canopy-card__move-select"
        aria-keyshortcuts="ArrowLeft ArrowRight"
        aria-label=${`${t("canopy.fieldStatus")}: ${card.title}`}
        .value=${card.status}
        ?disabled=${busy || !props.connected || !props.client}
        @change=${(event: Event) => {
          void moveCardToStatus(
            props,
            card,
            (event.currentTarget as HTMLSelectElement).value as CanopyStatus,
          );
        }}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
          }
          if (
            state.busyCardIds.has(card.id) ||
            state.dispatching ||
            !props.connected ||
            !props.client
          ) {
            event.preventDefault();
            return;
          }
          const offset = event.key === "ArrowRight" ? 1 : -1;
          const status = statuses[statuses.indexOf(card.status) + offset];
          if (!status) {
            return;
          }
          event.preventDefault();
          void moveCardToStatus(props, card, status);
        }}
      >
        ${statuses.map(
          (status) => html`<option value=${status} ?selected=${status === card.status}>
            ${formatStatusLabel(status)}
          </option>`,
        )}
      </select>
      <span class="canopy-card__move-chevron" aria-hidden="true">${icons.chevronDown}</span>
    </label>
  `;
}

export function getCardActionState(props: CanopyProps, card: CanopyCard) {
  const state = getCanopyState(props.host);
  const session = findCanopySession(card, props.sessions, props.sessionResolution);
  const linkedSessionKey = canopyCardSessionKey(card);
  const sessionTarget = canopyCardSessionTarget(
    card,
    session
      ? { sessionKey: session.key, ...(session.agentId ? { agentId: session.agentId } : {}) }
      : undefined,
  );
  const busy = state.busyCardIds.has(card.id) || state.dispatching;
  const writable = canMutate(props);
  const live =
    cardHasUnresolvedStartedRun(card) ||
    session?.hasActiveRun === true ||
    (session?.hasActiveRun !== false && session?.status === "running");
  return {
    state,
    busy,
    live,
    linkedSessionKey,
    sessionTarget,
    writable,
    showStartControls: writable && canStartCanopyCard(card),
    archived: Boolean(card.metadata?.archivedAt),
  };
}

function renderCardActionButton(params: {
  label: string;
  icon: TemplateResult;
  className?: string;
  disabled?: boolean;
  ariaHaspopup?: "dialog";
  onClick: (event: MouseEvent) => void;
  requestAction?: (action: () => void) => void;
}) {
  return html`
    <button
      class=${`btn ${params.className ?? ""}`}
      type="button"
      aria-label=${params.label}
      aria-haspopup=${params.ariaHaspopup ?? nothing}
      ?disabled=${params.disabled}
      @click=${(event: MouseEvent) => {
        if (params.requestAction) {
          params.requestAction(() => params.onClick(event));
        } else {
          params.onClick(event);
        }
      }}
    >
      ${params.icon}<span>${params.label}</span>
    </button>
  `;
}

export function renderEditCardAction(
  props: CanopyProps,
  card: CanopyCard,
  options: { requestAction?: (action: () => void) => void } = {},
) {
  const state = getCanopyState(props.host);
  return renderCardActionButton({
    label: t("canopy.editCard"),
    icon: icons.edit,
    requestAction: options.requestAction,
    ariaHaspopup: "dialog",
    disabled: state.dispatching,
    onClick: () => {
      openEditModal(state, card);
      props.onRequestUpdate?.();
    },
  });
}

export function renderArchiveCardAction(
  props: CanopyProps,
  card: CanopyCard,
  busy: boolean,
  archived: boolean,
  options: { requestAction?: (action: () => void) => void } = {},
) {
  const label = archived ? t("canopy.unarchiveCard") : t("canopy.archiveCard");
  return renderCardActionButton({
    label,
    icon: archived ? icons.archiveRestore : icons.archive,
    requestAction: options.requestAction,
    disabled: busy,
    onClick: () => {
      void archiveCanopyCard({
        host: props.host,
        client: props.client,
        cardId: card.id,
        archived: !archived,
        requestUpdate: props.onRequestUpdate,
      });
    },
  });
}

export function renderOpenSessionCardAction(
  props: CanopyProps,
  session: BoardGetParams | undefined,
  options: { quiet?: boolean } = {},
) {
  if (!session) {
    return nothing;
  }
  if (options.quiet) {
    return html`<button
      type="button"
      class="canopy-detail__session-link"
      @click=${() => props.onOpenSession(session)}
    >
      ${t("canopy.openSession")}
    </button>`;
  }
  return renderCardActionButton({
    label: t("canopy.openSession"),
    icon: icons.messageSquare,
    onClick: () => props.onOpenSession(session),
  });
}

export function renderStopCardAction(props: CanopyProps, card: CanopyCard, busy: boolean) {
  return renderCardActionButton({
    label: t("canopy.stopSession"),
    icon: icons.stop,
    disabled: busy || !props.connected,
    onClick: () => {
      void stopCanopyCard({
        host: props.host,
        client: props.client,
        card,
        session: getCardActionState(props, card).sessionTarget,
        requestUpdate: props.onRequestUpdate,
      });
    },
  });
}

export function renderDeleteCardAction(
  props: CanopyProps,
  card: CanopyCard,
  busy: boolean,
  options: { requestAction?: (action: () => void) => void } = {},
) {
  return renderCardActionButton({
    label: t("canopy.deleteCard"),
    icon: icons.trash,
    requestAction: options.requestAction,
    className: "canopy-card__delete",
    disabled: busy,
    onClick: () => {
      void deleteCanopyCard({
        host: props.host,
        client: props.client,
        cardId: card.id,
        requestUpdate: props.onRequestUpdate,
      });
    },
  });
}

export function renderStartExecutionButton(
  props: CanopyProps,
  card: CanopyCard,
  engine: CanopyExecutionEngine | null,
  mode: CanopyExecutionMode,
) {
  const state = getCanopyState(props.host);
  const busy = state.busyCardIds.has(card.id) || state.dispatching;
  const runtimeBlock = engineBlockedByRuntime(props, card, engine);
  const engineName = engine === "codex" ? t("canopy.engineOpenAI") : t("canopy.engineClaude");
  const disabled =
    busy || !props.connected || Boolean(runtimeBlock) || Boolean(card.metadata?.archivedAt);
  const title = runtimeBlock
    ? runtimeBlock
    : engine
      ? mode === "autonomous"
        ? t("canopy.runEngine", { engine: engineName })
        : t("canopy.openEngine", { engine: engineName })
      : t("canopy.runDefaultAgent");
  return html`
    <button
      class="btn btn--xs canopy-card__start canopy-card__start--${mode}  ${engine ? "" : "canopy-card__start--default"}"
      type="button"
      aria-label=${title}
      ?disabled=${disabled}
      @click=${async () => {
        const key = await startCanopyCard({
          host: props.host,
          client: props.client,
          card,
          ...(engine ? { engine } : {}),
          mode,
          requestUpdate: props.onRequestUpdate,
        });
        if (key) {
          props.onOpenSession({ sessionKey: key });
        }
      }}
    >
      ${
        engine
          ? html`<span>${engineName}</span>`
          : html`${mode === "autonomous" ? icons.play : icons.penLine}<span
                >${t("canopy.start")}</span
              >`
      }
    </button>
  `;
}
