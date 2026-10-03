import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import {
  renderAgentPicker,
  renderDialog,
  renderSelectPicker,
} from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyToast } from "../../components/toast.ts";
import { t } from "../../i18n/index.ts";
import {
  changedDraftPayload,
  draftPayload,
  canopyCardSessionKey,
} from "../../lib/canopy/card-state.ts";
import {
  addCanopyCardComment,
  getCanopyState,
  resetDraftState,
  saveCanopyCardDraft,
  CANOPY_PRIORITIES,
  type CanopyCard,
  type CanopyPriority,
  type CanopyStatus,
  type CanopyTemplateId,
  type CanopyUiState,
} from "../../lib/canopy/index.ts";
import { buildAssignableAgentPickerOptions } from "./agent-filter.ts";
import {
  canMutate,
  formatPriorityLabel,
  canopyErrorMessage,
  renderPriorityIcon,
  formatStatusLabel,
  isCanopySessionChoice,
  type CanopyProps,
} from "./view-helpers.ts";
import type { CanopySelectOption } from "./canopy-select.ts";

const canopyCardModalTitleId = "canopy-card-modal-title";
const canopyCardModalDescriptionId = "canopy-card-modal-description";
export const canopyCardModalId = "canopy-card-modal";
const initialDrafts = new WeakMap<CanopyUiState, string>();

function draftFingerprint(state: CanopyUiState): string {
  const payload = draftPayload(state);
  return JSON.stringify({ ...payload, title: payload.title.trim(), notes: payload.notes.trim() });
}

// Keep keystroke state local to the form. A parent render can restore stale
// controlled values before the next field is edited or the draft is submitted.
function syncDraftTextInput(
  state: CanopyUiState,
  form: HTMLFormElement,
  input: HTMLInputElement | HTMLTextAreaElement,
  draftActionsBusy: boolean,
) {
  if (input.classList.contains("canopy-draft__title")) {
    state.draftTitle = input.value;
  } else if (input.classList.contains("canopy-draft__notes")) {
    state.draftNotes = input.value;
  } else if (input.classList.contains("canopy-draft__labels")) {
    state.draftLabels = input.value;
  } else if (input.classList.contains("canopy-comments__input")) {
    state.draftCommentBody = input.value;
  } else {
    return;
  }

  const draftSubmit = form.querySelector<HTMLButtonElement>(".canopy-draft__submit");
  if (draftSubmit) {
    draftSubmit.disabled = draftActionsBusy || !state.draftTitle.trim();
  }
  const commentSubmit = form.querySelector<HTMLButtonElement>(".canopy-comments__submit");
  if (commentSubmit) {
    commentSubmit.disabled = draftActionsBusy || !state.draftCommentBody.trim();
  }
}

function defineTemplate(
  id: CanopyTemplateId,
  draftKey: string,
  labels: string,
  priority: CanopyPriority,
) {
  return { id, draftKey, labels, priority };
}

const canopyTemplates = [
  defineTemplate("bugfix", "bugfix", "fix, test", "high"),
  defineTemplate("docs", "docs", "docs", "normal"),
  defineTemplate("release", "release", "release", "urgent"),
  defineTemplate("pr_review", "prReview", "review", "normal"),
  defineTemplate("plugin", "plugin", "plugin", "normal"),
];

export function openCreateModal(
  state: CanopyUiState,
  props: Pick<CanopyProps, "agentsList" | "defaultAgentId" | "scopeAgentId">,
  status: CanopyStatus = "todo",
) {
  resetDraftState(state);
  state.draftStatus = status;
  const scopedAgentId = props.scopeAgentId?.trim();
  const defaultAgentId = props.agentsList?.defaultId?.trim() ?? props.defaultAgentId?.trim();
  const selectedAgentId = scopedAgentId
    ? scopedAgentId === defaultAgentId
      ? ""
      : scopedAgentId
    : state.agentFilter === "all" || state.agentFilter === "default"
      ? ""
      : state.agentFilter;
  if (
    selectedAgentId &&
    (props.agentsList
      ? buildAssignableAgentPickerOptions(props.agentsList, "").some(
          (agent) => agent.value === selectedAgentId,
        )
      : Boolean(scopedAgentId))
  ) {
    state.draftAgentId = selectedAgentId;
  }
  initialDrafts.set(state, draftFingerprint(state));
  state.draftOpen = true;
}

export function openEditModal(state: CanopyUiState, card: CanopyCard) {
  state.draftDiscardOpen = false;
  state.draftOpen = true;
  state.editingCardId = card.id;
  state.editingCardBase = card;
  state.draftTitle = card.title;
  state.draftNotes = card.notes ?? "";
  state.draftStatus = card.status;
  state.draftPriority = card.priority;
  state.draftLabels = card.labels.join(", ");
  state.draftAgentId = card.agentId ?? "";
  state.draftSessionKey = canopyCardSessionKey(card) ?? "";
  state.draftTemplateId = card.metadata?.templateId ?? "";
  state.draftCommentBody = "";
}

function applyTemplate(state: CanopyUiState, templateId: CanopyTemplateId) {
  const template = canopyTemplates.find((entry) => entry.id === templateId);
  if (!template) {
    return;
  }
  state.draftTemplateId = template.id;
  state.draftTitle = t(`canopy.templateDraft.${template.draftKey}Title`);
  state.draftNotes = t(`canopy.templateDraft.${template.draftKey}Notes`);
  state.draftLabels = template.labels;
  state.draftPriority = template.priority;
}

function renderDraftChoices<Value extends string>(params: {
  name: "status" | "priority";
  label: string;
  value: Value;
  options: readonly CanopySelectOption<Value>[];
  renderIcon?: (value: Value) => unknown;
  disabled: boolean;
  onChange: (value: Value) => void;
}) {
  return html`
    <fieldset
      class="canopy-choice-field ${params.name === "status" ? "canopy-field--wide" : ""}"
      ?disabled=${params.disabled}
    >
      <legend>${params.label}</legend>
      <div class="canopy-segments canopy-segments--${params.name}">
        ${params.options.map(
          (option) => html`
            <label
              class="canopy-segment ${
                params.name === "status" ? `canopy-segment--${option.value}` : ""
              }"
            >
              <input
                type="radio"
                name=${params.name}
                value=${option.value}
                .checked=${params.value === option.value}
                @change=${() => params.onChange(option.value)}
              />
              <span
                >${
                  params.renderIcon
                    ? html`<i aria-hidden="true">${params.renderIcon(option.value)}</i>`
                    : nothing
                }${option.label}</span
              >
            </label>
          `,
        )}
      </div>
    </fieldset>
  `;
}

export function renderCardModal(props: CanopyProps) {
  const state = getCanopyState(props.host);
  const visibleError = canopyErrorMessage(state, props.pageError);
  const sessions = props.sessions.filter(isCanopySessionChoice);
  const statusOptions: CanopySelectOption<CanopyStatus>[] = state.statuses.map((status) => ({
    value: status,
    label: formatStatusLabel(status),
  }));
  const priorityOptions: CanopySelectOption<CanopyPriority>[] = CANOPY_PRIORITIES.map(
    (priority) => ({ value: priority, label: formatPriorityLabel(priority) }),
  );
  const defaultAgentId = props.agentsList?.defaultId ?? props.defaultAgentId ?? "";
  const assignableAgentOptions = buildAssignableAgentPickerOptions(
    props.agentsList,
    state.draftAgentId,
    defaultAgentId,
  );
  const sessionOptions = [
    { value: "", label: t("canopy.noLinkedSession") },
    ...sessions.map((session) => ({
      value: session.key,
      label: session.displayName ?? session.label ?? session.key,
      description: session.displayName || session.label ? session.key : undefined,
    })),
  ];
  if (
    state.draftSessionKey &&
    !sessionOptions.some((option) => option.value === state.draftSessionKey)
  ) {
    sessionOptions.push({ value: state.draftSessionKey, label: state.draftSessionKey });
  }
  if (!state.draftOpen) {
    return nothing;
  }
  const editing = Boolean(state.editingCardId);
  const editingCard = state.editingCardId
    ? (state.cards.find((card) => card.id === state.editingCardId) ?? null)
    : null;
  const comments = editingCard?.metadata?.comments ?? [];
  const draftCommentBusy = editing && state.busyCardIds.has(state.editingCardId ?? "");
  const draftActionsBusy =
    !canMutate(props) ||
    state.loading ||
    state.dispatching ||
    state.draftSaving ||
    draftCommentBusy;
  // Save completion resets this shared draft. Lock every edit and dismissal path
  // only for that write so stale drafts can still use Cancel to recover readiness.
  const draftDismissalBusy = state.draftSaving;
  const dismissDraft = () => {
    if (draftDismissalBusy) {
      return false;
    }
    const changed =
      state.draftCommentBody.trim() ||
      (editing
        ? Object.keys(changedDraftPayload(state)).length > 0
        : draftFingerprint(state) !== initialDrafts.get(state));
    if (changed) {
      state.draftDiscardOpen = true;
      props.onRequestUpdate?.();
      return false;
    }
    resetDraftState(state);
    return true;
  };
  const draftDialog = renderDialog(
    {
      label: editing ? t("canopy.editCard") : t("canopy.newCard"),
      description: editing ? t("canopy.editCardHelp") : t("canopy.newCardHelp"),
      style:
        "--branch-modal-width: 700px; --branch-modal-max-height: calc(100dvh - 40px); --branch-modal-backdrop-filter: blur(1px); --wa-color-overlay-modal: rgba(0, 0, 0, 0.32);",
      onCancel: () => {
        if (!dismissDraft()) {
          return false;
        }
        props.onRequestUpdate?.();
        return true;
      },
    },
    html`
      <form
        id=${canopyCardModalId}
        class="canopy-draft canopy-card-draft"
        aria-busy=${draftActionsBusy ? "true" : "false"}
        @input=${(event: InputEvent) => {
          const input = event.target;
          if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
            syncDraftTextInput(
              state,
              event.currentTarget as HTMLFormElement,
              input,
              draftActionsBusy,
            );
          }
        }}
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          if (draftActionsBusy) {
            return;
          }
          void saveCanopyCardDraft({
            host: props.host,
            client: props.client,
            requestUpdate: props.onRequestUpdate,
          });
        }}
      >
        <div class="canopy-modal__header">
          <div>
            <h2 id=${canopyCardModalTitleId}>
              ${editing ? t("canopy.editCard") : t("canopy.newCard")}
            </h2>
            <p id=${canopyCardModalDescriptionId} class="canopy-draft__accessible-label">
              ${editing ? t("canopy.editCardHelp") : t("canopy.newCardHelp")}
            </p>
          </div>
          <span title=${t("common.cancel")}>
            <button
              class="btn btn--icon canopy-modal__close"
              type="button"
              aria-label=${t("common.cancel")}
              ?disabled=${draftDismissalBusy}
              @click=${() => {
                if (dismissDraft()) {
                  props.onRequestUpdate?.();
                }
              }}
            >
              ${icons.x}
            </button>
          </span>
        </div>
        <div class="canopy-draft__body">
          <div class="canopy-draft__main">
            <label class="canopy-field">
              <span class="canopy-draft__accessible-label">${t("canopy.fieldTitle")}</span>
              <input
                class="settings-input canopy-draft__title"
                autofocus
                placeholder=${t("canopy.titlePlaceholder")}
                ?disabled=${draftActionsBusy}
                .value=${live(state.draftTitle)}
              />
            </label>
            ${
              !editing
                ? html`
                    <div
                      class="canopy-template-strip"
                      aria-label=${t("canopy.templatesLabel")}
                    >
                      <span class="canopy-template-strip__label"
                        >${t("canopy.suggestionsLabel")}</span
                      >
                      ${canopyTemplates.map(
                        (template) => html`
                          <button
                            class="canopy-template-strip__suggestion"
                            type="button"
                            ?disabled=${draftActionsBusy}
                            @click=${() => {
                              applyTemplate(state, template.id);
                              props.onRequestUpdate?.();
                            }}
                          >
                            ${icons.plus} ${t(`canopy.template.${template.id}`)}
                          </button>
                        `,
                      )}
                    </div>
                  `
                : nothing
            }
            <label class="canopy-field">
              <span class="canopy-draft__accessible-label">${t("canopy.fieldNotes")}</span>
              <textarea
                class="settings-input canopy-draft__notes"
                rows="3"
                placeholder=${t("canopy.notesPlaceholder")}
                ?disabled=${draftActionsBusy}
                .value=${live(state.draftNotes)}
              ></textarea>
            </label>
          </div>
          <div class="canopy-draft__meta">
            ${renderDraftChoices({
              name: "status",
              value: state.draftStatus,
              options: statusOptions,
              label: t("canopy.fieldStatus"),
              onChange: (value) => {
                state.draftStatus = value;
                props.onRequestUpdate?.();
              },
              disabled: draftActionsBusy,
            })}
            <div class="canopy-field">
              <span>${t("canopy.fieldAgent")}</span>
              ${renderAgentPicker(
                {
                  options: assignableAgentOptions,
                  value: state.draftAgentId,
                  accessibleLabel: t("canopy.fieldAgent"),
                  disabled: draftActionsBusy,
                  onSelect: (value: string) => {
                    state.draftAgentId = value;
                    props.onRequestUpdate?.();
                  },
                },
                "canopy-agent-select",
              )}
            </div>
            <div class="canopy-field">
              <span>${t("canopy.fieldSession")}</span>
              ${renderSelectPicker(
                {
                  value: state.draftSessionKey,
                  options: sessionOptions,
                  accessibleLabel: t("canopy.fieldSession"),
                  searchable: true,
                  onSelect: (value) => {
                    state.draftSessionKey = value;
                    props.onRequestUpdate?.();
                  },
                  disabled: draftActionsBusy,
                },
                "canopy-session-select",
              )}
            </div>
            ${renderDraftChoices({
              name: "priority",
              value: state.draftPriority,
              options: priorityOptions,
              renderIcon: renderPriorityIcon,
              label: t("canopy.fieldPriority"),
              onChange: (value) => {
                state.draftPriority = value;
                props.onRequestUpdate?.();
              },
              disabled: draftActionsBusy,
            })}
            <label class="canopy-field">
              <span>${t("canopy.fieldLabels")}</span>
              <input
                class="settings-input canopy-draft__labels"
                spellcheck="false"
                placeholder=${t("canopy.labelsPlaceholder")}
                ?disabled=${draftActionsBusy}
                .value=${live(state.draftLabels)}
              />
            </label>
          </div>
          ${
            editing
              ? html`
                  <section
                    class="canopy-field canopy-field--wide"
                    aria-labelledby="canopy-card-comments-title"
                  >
                    <span id="canopy-card-comments-title">
                      ${t("canopy.badgeComments", { count: String(comments.length) })}
                    </span>
                    ${
                      comments.length
                        ? html`
                            <ol>
                              ${comments.map((comment) => html`<li>${comment.body}</li>`)}
                            </ol>
                          `
                        : nothing
                    }
                    <textarea
                      class="settings-input canopy-comments__input"
                      aria-labelledby="canopy-card-comments-title"
                      maxlength="2000"
                      ?disabled=${draftActionsBusy}
                      .value=${state.draftCommentBody}
                    ></textarea>
                    <div class="canopy-modal__actions">
                      <button
                        class="btn canopy-comments__submit"
                        type="button"
                        ?disabled=${draftActionsBusy || !state.draftCommentBody.trim()}
                        @click=${() => {
                          void addCanopyCardComment({
                            host: props.host,
                            client: props.client,
                            requestUpdate: props.onRequestUpdate,
                          });
                        }}
                      >
                        ${icons.plus} ${t("common.create")}
                      </button>
                    </div>
                  </section>
                `
              : nothing
          }
        </div>
        <div class="canopy-modal__actions">
          <button
            class="btn"
            type="button"
            ?disabled=${draftDismissalBusy}
            @click=${() => {
              if (dismissDraft()) {
                props.onRequestUpdate?.();
              }
            }}
          >
            ${t("common.cancel")}
          </button>
          <button
            class="btn primary canopy-draft__submit"
            ?disabled=${draftActionsBusy || !state.draftTitle.trim()}
          >
            ${editing ? t("common.save") : t("common.create")}
          </button>
        </div>
      </form>
      ${renderCanopyToast({
        owner: state,
        message: visibleError ?? "",
        key: visibleError,
        tone: "error",
        hidden: state.draftDiscardOpen,
      })}
    `,
  );
  const keepEditing = () => {
    state.draftDiscardOpen = false;
    props.onRequestUpdate?.();
  };
  const discardTitle = editing
    ? t("canopy.discardChangesTitle")
    : t("canopy.discardCardTitle");
  return html`
    ${draftDialog}
    ${
      state.draftDiscardOpen
        ? renderCardDiscardDialog({
            title: discardTitle,
            onKeepEditing: keepEditing,
            onDiscard: () => {
              if (state.draftSaving) {
                return;
              }
              resetDraftState(state);
              props.onRequestUpdate?.();
            },
            error: renderCanopyToast({
              owner: state,
              message: visibleError ?? "",
              key: visibleError,
              tone: "error",
            }),
          })
        : nothing
    }
  `;
}

export function renderCardDiscardDialog(props: {
  title: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
  error?: unknown;
}) {
  return renderDialog(
    {
      label: props.title,
      description: t("canopy.discardDraftHelp"),
      style:
        "--branch-modal-width: 400px; --branch-modal-backdrop-filter: none; --wa-color-overlay-modal: rgba(0, 0, 0, 0.24);",
      onCancel: () => {
        props.onKeepEditing();
        return true;
      },
    },
    html`
      <section class="canopy-discard">
        <h2>${props.title}</h2>
        <p>${t("canopy.discardDraftHelp")}</p>
        <div class="canopy-discard__actions">
          <button class="btn" type="button" autofocus @click=${props.onKeepEditing}>
            ${t("canopy.keepEditing")}
          </button>
          <button class="btn danger" type="button" @click=${props.onDiscard}>
            ${t("canopy.discardDraft")}
          </button>
        </div>
      </section>
      ${props.error ?? nothing}
    `,
  );
}
