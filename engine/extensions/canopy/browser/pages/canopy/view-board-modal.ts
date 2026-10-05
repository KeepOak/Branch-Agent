import {
  normalizeCanopySessionsBoardSpec,
  type CanopySessionsBoardSpec,
} from "@branch/canopy-contract";
import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { renderAppearancePicker, renderDialog } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { renderCanopyToast, updateCanopyToastOutcome } from "../../components/toast.ts";
import { renderCanopyBoardGlyph } from "../../components/canopy-board-glyph.ts";
import { t } from "../../i18n/index.ts";
import { formatUiError } from "../../lib/format-error.ts";
import type { CanopyBoardMetadata, CanopyBoardSummary } from "../../lib/canopy/types.ts";

export type BoardDraft = {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: "cards" | "sessions";
  create?: boolean;
  sessions?: CanopySessionsBoardSpec;
  saving: boolean;
  error: string | null;
};
const originals = new WeakMap<BoardDraft, Pick<BoardDraft, "name" | "icon" | "color">>();

export function createBoardDraft(board: CanopyBoardSummary): BoardDraft {
  const fields = { name: board.name ?? board.id, icon: board.icon ?? "", color: board.color ?? "" };
  const draft: BoardDraft = {
    id: board.id,
    ...fields,
    kind: board.kind ?? "cards",
    ...(board.sessions ? { sessions: structuredClone(board.sessions) } : {}),
    saving: false,
    error: null,
  };
  originals.set(draft, fields);
  return draft;
}

export function createNewBoardDraft(): BoardDraft {
  const draft: BoardDraft = {
    id: `board-${crypto.randomUUID()}`,
    name: "",
    icon: "",
    color: "",
    kind: "cards",
    create: true,
    saving: false,
    error: null,
  };
  originals.set(draft, { name: "", icon: "", color: "" });
  return draft;
}

export function renderBoardModal(props: {
  draft: BoardDraft;
  pageError?: string | null;
  toastOwner: object;
  client: GatewayBrowserClient | null;
  readonly canWrite: boolean;
  onSaved: (board: CanopyBoardMetadata) => void;
  onCancel: () => void;
  requestUpdate: () => void;
}) {
  const { draft } = props;
  const visibleError = draft.error ?? props.pageError;
  updateCanopyToastOutcome(draft, {
    message: draft.error ?? "",
    key: draft.error,
    tone: "error",
  });
  const save = async () => {
    if (!props.client || !props.canWrite || draft.saving || !draft.name.trim()) {
      return;
    }
    let sessions: CanopySessionsBoardSpec | undefined;
    try {
      sessions = draft.sessions ? normalizeCanopySessionsBoardSpec(draft.sessions) : undefined;
    } catch (error) {
      draft.error = formatUiError(error);
      props.requestUpdate();
      return;
    }
    const input: Record<string, string | string[]> = { id: draft.id };
    if (draft.create && draft.kind === "sessions") {
      input.kind = "sessions";
    }
    const clearAppearance: string[] = [];
    const original = originals.get(draft);
    for (const field of ["name", "icon", "color"] as const) {
      const value = draft[field].trim();
      if (value !== original?.[field]) {
        if (!value && field !== "name") {
          clearAppearance.push(field);
        } else {
          input[field] = value;
        }
      }
    }
    if (clearAppearance.length > 0) {
      input.clearAppearance = clearAppearance;
    }
    draft.saving = true;
    draft.error = null;
    props.requestUpdate();
    try {
      const { board } = await props.client.request<{ board: CanopyBoardMetadata }>(
        "canopy.boards.upsert",
        input,
      );
      if (sessions) {
        if (!props.canWrite) {
          throw new Error(t("canopy.sessionsBoard.writeUnavailable"));
        }
        await props.client.request("canopy.sessionsBoard.update", {
          boardId: draft.id,
          patch: { columns: sessions.columns },
        });
      }
      props.onSaved(board);
    } catch (error) {
      draft.error = formatUiError(error);
    } finally {
      draft.saving = false;
      props.requestUpdate();
    }
  };
  return renderDialog(
    {
      label: t(draft.create ? "canopy.newBoard" : "canopy.editBoard"),
      style: `--branch-modal-width: ${draft.sessions ? "640px" : "420px"}; --branch-modal-backdrop-filter: blur(1px);`,
      onCancel: () => {
        if (draft.saving) {
          return false;
        }
        props.onCancel();
        return true;
      },
    },
    html`<form
        class="canopy-draft canopy-board-draft"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          void save();
        }}
      >
        <div class="canopy-modal__header">
          <h2>${t(draft.create ? "canopy.newBoard" : "canopy.editBoard")}</h2>
          <button
            class="btn btn--icon canopy-modal__close"
            type="button"
            aria-label=${t("common.close")}
            ?disabled=${draft.saving}
            @click=${props.onCancel}
          >
            ${icons.x}
          </button>
        </div>
        ${
          draft.create
            ? html`<fieldset
                class="canopy-board-kind"
                ?disabled=${draft.saving || !props.canWrite}
              >
                <legend>${t("canopy.boardKind")}</legend>
                ${(["cards", "sessions"] as const).map(
                  (kind) =>
                    html`<label
                      ><input
                        type="radio"
                        name="board-kind"
                        value=${kind}
                        .checked=${draft.kind === kind}
                        @change=${() => {
                          draft.kind = kind;
                          props.requestUpdate();
                        }}
                      />${t(kind === "cards" ? "canopy.cardsBoard" : "canopy.sessionsBoard.kind")}</label
                    >`,
                )}
              </fieldset>`
            : nothing
        }
        <div class="canopy-board-draft__identity">
          <div class="canopy-board-draft__preview">${renderCanopyBoardGlyph(draft)}</div>
          <label class="canopy-board-draft__name">
            <span>${t("canopy.boardName")}</span>
            <input
              class="settings-input"
              autofocus
              required
              maxlength="120"
              .value=${live(draft.name)}
              ?disabled=${draft.saving || !props.canWrite}
              @input=${(event: Event) => {
                if (!(event.currentTarget instanceof HTMLInputElement)) {
                  return;
                }
                draft.name = event.currentTarget.value;
                props.requestUpdate();
              }}
            />
          </label>
        </div>
        <section
          class="canopy-board-draft__appearance"
          aria-label=${t("canopy.boardAppearance")}
        >
          ${renderAppearancePicker({
            icon: draft.icon || null,
            color: draft.color || null,
            disabled: draft.saving || !props.canWrite,
            clearable: true,
            onChange: ({ icon, color }) => {
              draft.icon = icon ?? "";
              draft.color = color ?? "";
              props.requestUpdate();
            },
          })}
        </section>
        ${draft.sessions ? renderSessionsEditor(draft, props.canWrite, props.requestUpdate) : nothing}
        ${draft.sessions && visibleError ? html`<div class="canopy-sessions__warning" role="alert">${visibleError}</div>` : nothing}
        <div class="canopy-modal__actions">
          <button class="btn" type="button" ?disabled=${draft.saving} @click=${props.onCancel}>
            ${t("common.cancel")}
          </button>
          <button
            class="btn primary"
            type="submit"
            ?disabled=${draft.saving || !props.client || !props.canWrite || !draft.name.trim()}
          >
            ${t(draft.create ? "common.create" : "common.save")}
          </button>
        </div>
      </form>
      ${renderCanopyToast({
        owner: draft.error ? draft : props.toastOwner,
        message: visibleError ?? "",
        key: visibleError,
        tone: "error",
      })}`,
  );
}

function renderSessionsEditor(draft: BoardDraft, canWrite: boolean, requestUpdate: () => void) {
  const spec = draft.sessions;
  if (!spec) {
    return nothing;
  }
  const disabled = draft.saving || !canWrite;
  return html`<fieldset class="canopy-sessions-editor" ?disabled=${disabled}>
    <legend>${t("canopy.sessionsBoard.columns")}</legend>
    ${spec.columns.map(
      (column, index) => html`<div
        class="canopy-sessions-editor__column"
        data-column-id=${column.id}
      >
        <label
          ><span>${t("canopy.sessionsBoard.columnLabel")}</span
          ><input
            class="settings-input"
            required
            maxlength="60"
            aria-label=${t("canopy.sessionsBoard.columnLabel")}
            .value=${live(column.label)}
            @input=${(event: Event) => {
              if (event.currentTarget instanceof HTMLInputElement) {
                column.label = event.currentTarget.value;
                requestUpdate();
              }
            }}
        /></label>
        <label
          ><span>${t("canopy.boardColor")}</span
          ><select
            class="settings-input"
            aria-label=${t("canopy.boardColor")}
            .value=${column.color ?? ""}
            @change=${(event: Event) => {
              if (event.currentTarget instanceof HTMLSelectElement) {
                column.color = event.currentTarget.value || undefined;
                requestUpdate();
              }
            }}
          >
            <option value="">${t("canopy.sessionsBoard.defaultColor")}</option>
            ${["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"].map((color) => html`<option value=${color}>${t(`canopy.sessionsBoard.color.${color}`)}</option>`)}
          </select></label
        >
        <label class="canopy-sessions-editor__description"
          ><span>${t("canopy.sessionsBoard.description")}</span
          ><textarea
            class="settings-input"
            required
            maxlength="400"
            rows="2"
            aria-label=${t("canopy.sessionsBoard.description")}
            .value=${live(column.description)}
            @input=${(event: Event) => {
              if (event.currentTarget instanceof HTMLTextAreaElement) {
                column.description = event.currentTarget.value;
                requestUpdate();
              }
            }}
          ></textarea>
        </label>
        <label
          ><input
            type="radio"
            name="sessions-fallback"
            .checked=${Boolean(column.fallback)}
            @change=${() => {
              for (const entry of spec.columns) {
                entry.fallback = entry.id === column.id;
              }
              requestUpdate();
            }}
          />${t("canopy.sessionsBoard.fallback")}</label
        >
        <div class="canopy-sessions-editor__actions">
          ${[-1, 1].map(
            (offset) => html`<button
              class="btn"
              type="button"
              ?disabled=${disabled || index + offset < 0 || index + offset >= spec.columns.length}
              @click=${() => {
                spec.columns.splice(index, 1);
                spec.columns.splice(index + offset, 0, column);
                requestUpdate();
              }}
            >
              ${t(offset < 0 ? "canopy.sessionsBoard.moveUp" : "canopy.sessionsBoard.moveDown")}
            </button>`,
          )}
          <button
            class="btn"
            type="button"
            ?disabled=${disabled || spec.columns.length <= 2}
            @click=${() => {
              spec.columns.splice(index, 1);
              requestUpdate();
            }}
          >
            ${t("canopy.sessionsBoard.removeColumn")}
          </button>
        </div>
      </div>`,
    )}
    <button
      class="btn"
      type="button"
      ?disabled=${disabled || spec.columns.length >= 12}
      @click=${() => {
        spec.columns.push({
          id: `column-${crypto.randomUUID().slice(0, 8)}`,
          label: t("canopy.sessionsBoard.newColumn"),
          description: "",
        });
        requestUpdate();
      }}
    >
      ${icons.plus}${t("canopy.sessionsBoard.addColumn")}
    </button>
    <p class="canopy-sessions-editor__help">${t("canopy.sessionsBoard.rulesHelp")}</p>
  </fieldset>`;
}
