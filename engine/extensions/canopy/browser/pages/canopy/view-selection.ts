import { html, nothing } from "lit";
import { normalizeUniqueTrimmedStringList } from "branch/plugin-sdk/string-coerce-runtime";
import { renderDialog, renderSelectPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyToast } from "../../components/toast.ts";
import { canopyHost } from "../../host.ts";
import { t } from "../../i18n/index.ts";
import {
  isActiveCanopyCard,
  nextCanopyCardPosition,
} from "../../lib/canopy/card-state.ts";
import {
  archiveCanopyCard,
  deleteCanopyCard,
  moveCanopyCard,
  updateCanopyCardProperties,
} from "../../lib/canopy/mutations.ts";
import { getCanopyState, canopyHasActiveWrites } from "../../lib/canopy/runtime.ts";
import {
  CANOPY_PRIORITIES,
  type CanopyBulkDialog,
  type CanopyCard,
  type CanopyStatus,
} from "../../lib/canopy/types.ts";
import {
  buildAssignableAgentPickerOptions,
  matchesAgentScope,
  matchesAgentFilter,
} from "./agent-filter.ts";
import { matchesBoardFilter } from "./board-filter.ts";
import {
  canMutate,
  formatPriorityLabel,
  canopyErrorMessage,
  renderPriorityIcon,
  formatStatusLabel,
  type CanopyProps,
} from "./view-helpers.ts";

const KEEP_AGENT = "canopy:keep-agent";

type CardPatch = Partial<Pick<CanopyCard, "priority" | "labels" | "agentId">>;
type SelectionAction =
  | { kind: "move"; status: CanopyStatus }
  | { kind: "update"; patch: (card: CanopyCard) => CardPatch }
  | { kind: "archive" | "delete" };

const selectionScopes = new WeakMap<object, string>();

export function matchesCanopyCardScope(props: CanopyProps, card: CanopyCard): boolean {
  const state = getCanopyState(props.host);
  return (
    matchesBoardFilter(card, state.boardFilter) &&
    matchesAgentScope(
      card,
      props.agentsList?.defaultId ?? props.defaultAgentId,
      props.scopeAgentId,
    ) &&
    (props.showAgentFilter === false || matchesAgentFilter(card, state.agentFilter))
  );
}

export function reconcileSelectionScope(props: CanopyProps) {
  const state = getCanopyState(props.host);
  const scope = JSON.stringify([
    state.boardFilter,
    props.scopeAgentId ?? null,
    props.agentsList?.defaultId ?? props.defaultAgentId ?? null,
    props.showAgentFilter === false ? null : state.agentFilter,
  ]);
  const previous = selectionScopes.get(props.host);
  if (previous !== undefined && previous !== scope) {
    state.selectedCardIds = new Set();
    state.bulkDialog = null;
    state.bulkResult = null;
  }
  selectionScopes.set(props.host, scope);
  const eligible = new Set(
    state.cards
      .filter((card) => isActiveCanopyCard(card) && matchesCanopyCardScope(props, card))
      .map((card) => card.id),
  );
  for (const id of state.selectedCardIds) {
    if (!eligible.has(id)) {
      state.selectedCardIds.delete(id);
    }
  }
  if (state.bulkDialog) {
    state.bulkDialog.cardIds = state.bulkDialog.cardIds.filter((id) => eligible.has(id));
    if (!state.bulkDialog.cardIds.length) {
      state.bulkDialog = null;
    }
  }
}

async function applySelection(
  props: CanopyProps,
  cardIds: string[],
  action: SelectionAction,
  observedCards = getCanopyState(props.host).cards.filter((card) => cardIds.includes(card.id)),
) {
  const state = getCanopyState(props.host);
  if (
    !props.client ||
    !props.connected ||
    !canMutate(props) ||
    state.loading ||
    state.dispatching ||
    canopyHasActiveWrites(state)
  ) {
    return;
  }
  const owner = canopyHost();
  const selection = state.selectedCardIds;
  const board = state.boardFilter;
  const agentScope = owner.agents.scopeId;
  const localAgent = state.agentFilter;
  const observations = new Map(observedCards.map((card) => [card.id, card]));
  state.bulkSaving = true;
  state.bulkResult = null;
  state.error = null;
  let completed = 0;
  props.onRequestUpdate?.();
  try {
    for (const cardId of cardIds) {
      if (
        selection !== state.selectedCardIds ||
        board !== state.boardFilter ||
        agentScope !== owner.agents.scopeId ||
        localAgent !== state.agentFilter ||
        owner.signal.aborted ||
        !owner.connection.connected ||
        !owner.connection.canWrite ||
        !canMutate(props)
      ) {
        state.error = t("canopy.bulkUnavailable");
        break;
      }
      const card = state.cards.find((entry) => entry.id === cardId);
      if (
        !card ||
        !isActiveCanopyCard(card) ||
        !matchesCanopyCardScope(props, card) ||
        !state.selectedCardIds.has(cardId)
      ) {
        selection.delete(cardId);
        continue;
      }
      const observed = observations.get(cardId);
      if (!observed) {
        state.error = t("canopy.bulkUnavailable");
        break;
      }
      const common = {
        host: props.host,
        client: props.client,
        cardId,
        expectedUpdatedAt: observed.updatedAt,
        requestUpdate: props.onRequestUpdate,
      };
      let applied = false;
      switch (action.kind) {
        case "move":
          if (card.status !== action.status) {
            await moveCanopyCard({
              ...common,
              status: action.status,
              position: nextCanopyCardPosition(state.cards, card, action.status),
            });
          }
          applied =
            !state.error &&
            state.cards.find((entry) => entry.id === cardId)?.status === action.status;
          break;
        case "update": {
          const patch = action.patch(observed);
          applied =
            Object.keys(patch).length === 0 ||
            (await updateCanopyCardProperties({ ...common, card: observed, patch }));
          break;
        }
        case "archive":
          applied = await archiveCanopyCard({ ...common, archived: true });
          break;
        case "delete": {
          const result = await deleteCanopyCard(common);
          applied = Boolean(result);
          if (result) {
            for (const receipt of result.referenceUpdates ?? []) {
              const observation = observations.get(receipt.id);
              if (observation?.updatedAt === receipt.previousUpdatedAt) {
                observations.set(receipt.id, { ...observation, updatedAt: receipt.updatedAt });
              }
            }
          }
          break;
        }
      }
      if (!applied) {
        state.error ??= t("canopy.bulkUnavailable");
        break;
      }
      completed += 1;
      selection.delete(cardId);
    }
    if (selection !== state.selectedCardIds) {
      return;
    }
    state.bulkResult = { completed, total: cardIds.length };
    if (state.error) {
      state.error = `${t("canopy.bulkResult", { completed: String(completed), total: String(cardIds.length) })} ${state.error}`;
      if (state.bulkDialog) {
        state.bulkDialog.cardIds = cardIds.filter((id) => state.selectedCardIds.has(id));
        state.bulkDialog.observedCards = state.cards.filter((card) =>
          state.bulkDialog?.cardIds.includes(card.id),
        );
      }
    } else {
      state.bulkDialog = null;
    }
  } finally {
    state.bulkSaving = false;
    props.onRequestUpdate?.();
  }
}

function agentOptions(props: CanopyProps) {
  return buildAssignableAgentPickerOptions(
    props.agentsList ?? null,
    "",
    props.agentsList?.defaultId ?? props.defaultAgentId ?? undefined,
  ).map((option) => Object.assign({}, option, { description: option.badge }));
}

export function renderSelectionActions(props: CanopyProps) {
  const state = getCanopyState(props.host);
  const cardIds = state.cards
    .filter((card) => state.selectedCardIds.has(card.id))
    .map((card) => card.id);
  const busy = state.loading || state.dispatching || canopyHasActiveWrites(state);
  const disabled = !canMutate(props) || !props.connected || busy;
  const openDialog = (kind: "edit" | "delete") => {
    state.error = null;
    const observedCards = state.cards.filter((card) => cardIds.includes(card.id));
    state.bulkDialog =
      kind === "delete"
        ? { kind, cardIds, observedCards }
        : {
            kind,
            cardIds,
            observedCards,
            priority: "",
            agentId: KEEP_AGENT,
            labels: "",
            labelMode: "keep",
          };
    props.onRequestUpdate?.();
  };
  return html`
    <div
      class="canopy-selection"
      role="group"
      aria-label=${t("canopy.selectionLabel")}
      aria-busy=${state.bulkSaving}
    >
      <span class="canopy-selection__count" role="status"
        >${t(cardIds.length === 1 ? "canopy.selectedCountOne" : "canopy.selectedCount", {
          count: String(cardIds.length),
        })}</span
      >
      ${renderSelectPicker(
        {
          value: "",
          accessibleLabel: t("canopy.bulkMoveLabel"),
          disabled,
          options: [
            { value: "", label: t("canopy.bulkMoveLabel"), disabled: true },
            ...state.statuses.map((status) => ({
              value: status,
              label: formatStatusLabel(status),
            })),
          ],
          onSelect: (value) => {
            const status = state.statuses.find((entry) => entry === value);
            if (status) {
              void applySelection(props, cardIds, { kind: "move", status });
            }
          },
        },
        "canopy-selection__picker",
      )}
      ${renderSelectPicker(
        {
          value: KEEP_AGENT,
          accessibleLabel: t("canopy.bulkAssign"),
          disabled,
          options: [
            { value: KEEP_AGENT, label: t("canopy.bulkAssign"), disabled: true },
            ...agentOptions(props),
          ],
          onSelect: (agentId) => {
            if (agentOptions(props).some((option) => option.value === agentId)) {
              void applySelection(props, cardIds, { kind: "update", patch: () => ({ agentId }) });
            }
          },
        },
        "canopy-selection__picker",
      )}
      <button class="btn" type="button" ?disabled=${disabled} @click=${() => openDialog("edit")}>
        ${icons.edit}<span>${t("canopy.bulkEdit")}</span>
      </button>
      <span class="canopy-selection__separator" aria-hidden="true"></span>
      <button
        class="btn"
        type="button"
        ?disabled=${disabled}
        @click=${() => void applySelection(props, cardIds, { kind: "archive" })}
      >
        ${icons.archive}<span>${t("canopy.bulkArchive")}</span>
      </button>
      <button
        class="btn canopy-selection__delete"
        type="button"
        ?disabled=${disabled}
        @click=${() => openDialog("delete")}
      >
        ${icons.trash}<span>${t("canopy.bulkDelete")}</span>
      </button>
      <button
        class="btn btn--icon canopy-selection__clear"
        type="button"
        title=${t("canopy.clearSelection")}
        aria-label=${t("canopy.clearSelection")}
        ?disabled=${busy}
        @click=${() => {
          state.selectedCardIds.clear();
          props.onRequestUpdate?.();
        }}
      >
        ${icons.x}
      </button>
    </div>
  `;
}

function editPatch(
  draft: Extract<CanopyBulkDialog, { kind: "edit" }>,
  card: CanopyCard,
): CardPatch {
  const patch: CardPatch = {};
  if (draft.priority) {
    patch.priority = draft.priority;
  }
  if (draft.agentId !== KEEP_AGENT) {
    patch.agentId = draft.agentId;
  }
  const labels = normalizeUniqueTrimmedStringList(draft.labels.split(","));
  switch (draft.labelMode) {
    case "keep":
      break;
    case "add":
      patch.labels = [...new Set([...card.labels, ...labels])];
      break;
    case "replace":
      patch.labels = labels;
      break;
    case "remove":
      patch.labels = card.labels.filter((label) => !labels.includes(label));
      break;
  }
  return patch;
}

export function renderSelectionDialog(props: CanopyProps) {
  const state = getCanopyState(props.host);
  const visibleError = canopyErrorMessage(state, props.pageError);
  const draft = state.bulkDialog;
  if (!draft) {
    return nothing;
  }
  const close = () => {
    if (state.bulkSaving) {
      return false;
    }
    state.bulkDialog = null;
    props.onRequestUpdate?.();
    return true;
  };
  const title = t(
    draft.kind === "delete" ? "canopy.bulkDeleteTitle" : "canopy.bulkEditTitle",
    { count: String(draft.cardIds.length) },
  );
  const changed =
    draft.kind === "delete" ||
    Boolean(draft.priority || draft.agentId !== KEEP_AGENT || draft.labelMode !== "keep");
  const save = () =>
    void applySelection(
      props,
      draft.cardIds,
      draft.kind === "delete"
        ? { kind: "delete" }
        : { kind: "update", patch: (card) => editPatch(draft, card) },
      draft.observedCards,
    );
  return renderDialog(
    {
      label: title,
      style: "--branch-modal-width: 460px; --branch-modal-backdrop-filter: none;",
      onCancel: close,
    },
    html`
      <form
        class="canopy-bulk-dialog"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          save();
        }}
      >
        <div class="canopy-modal__header">
          <h2>${title}</h2>
          <button
            class="btn btn--icon canopy-modal__close"
            type="button"
            aria-label=${t("common.close")}
            ?disabled=${state.bulkSaving}
            @click=${close}
          >
            ${icons.x}
          </button>
        </div>
        ${
          draft.kind === "delete"
            ? html`<p>${t("canopy.bulkDeleteHelp")}</p>`
            : html`
                <p>${t("canopy.bulkEditHelp")}</p>
                <fieldset
                  class="canopy-choice-field"
                  aria-labelledby="canopy-bulk-priority-label"
                  ?disabled=${state.bulkSaving}
                >
                  <legend>
                    <span id="canopy-bulk-priority-label">${t("canopy.fieldPriority")}</span>
                    <button
                      class="canopy-bulk-dialog__reset"
                      type="button"
                      ?disabled=${state.bulkSaving || !draft.priority}
                      @click=${() => {
                        draft.priority = "";
                        props.onRequestUpdate?.();
                      }}
                    >
                      ${t("canopy.bulkKeep")}
                    </button>
                  </legend>
                  <div class="canopy-segments canopy-segments--priority">
                    ${CANOPY_PRIORITIES.map(
                      (priority) => html`<label class="canopy-segment">
                        <input
                          type="radio"
                          name="bulk-priority"
                          .checked=${draft.priority === priority}
                          @change=${() => {
                            draft.priority = priority;
                            props.onRequestUpdate?.();
                          }}
                        />
                        <span
                          ><i aria-hidden="true">${renderPriorityIcon(priority)}</i
                          >${formatPriorityLabel(priority)}</span
                        >
                      </label>`,
                    )}
                  </div>
                </fieldset>
                <div class="field">
                  <span>${t("canopy.fieldAgent")}</span>
                  ${renderSelectPicker({
                    value: draft.agentId,
                    disabled: state.bulkSaving,
                    accessibleLabel: t("canopy.fieldAgent"),
                    options: [
                      { value: KEEP_AGENT, label: t("canopy.bulkKeep") },
                      ...agentOptions(props),
                    ],
                    onSelect: (value) => {
                      draft.agentId = value;
                      props.onRequestUpdate?.();
                    },
                  })}
                </div>
                <div class="field">
                  <span>${t("canopy.fieldLabels")}</span>
                  ${renderSelectPicker({
                    value: draft.labelMode,
                    disabled: state.bulkSaving,
                    accessibleLabel: t("canopy.fieldLabels"),
                    options: (["keep", "add", "replace", "remove"] as const).map((value) => ({
                      value,
                      label: t(`canopy.bulkLabels_${value}`),
                    })),
                    onSelect: (value) => {
                      draft.labelMode =
                        (["keep", "add", "replace", "remove"] as const).find(
                          (entry) => entry === value,
                        ) ?? "keep";
                      props.onRequestUpdate?.();
                    },
                  })}
                  ${
                    draft.labelMode === "keep"
                      ? nothing
                      : html`<input
                          class="settings-input"
                          aria-label=${t("canopy.fieldLabels")}
                          placeholder=${t("canopy.bulkLabelsPlaceholder")}
                          .value=${draft.labels}
                          ?disabled=${state.bulkSaving}
                          @input=${(event: InputEvent) => {
                            if (!(event.currentTarget instanceof HTMLInputElement)) {
                              return;
                            }
                            draft.labels = event.currentTarget.value;
                          }}
                        />`
                  }
                </div>
              `
        }
        <div class="canopy-modal__actions">
          <button class="btn" type="button" autofocus ?disabled=${state.bulkSaving} @click=${close}>
            ${t("common.cancel")}
          </button>
          <button
            class=${draft.kind === "delete" ? "btn danger" : "btn primary"}
            type="submit"
            ?disabled=${state.bulkSaving || !changed || !props.connected || !canMutate(props)}
          >
            ${
              state.bulkSaving
                ? t("canopy.bulkApplying")
                : t(draft.kind === "delete" ? "canopy.bulkDelete" : "canopy.bulkApply")
            }
          </button>
        </div>
      </form>
      ${renderCanopyToast({
        owner: state,
        message: visibleError ?? "",
        key: visibleError,
        tone: "error",
      })}
    `,
  );
}
